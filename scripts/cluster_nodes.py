#!/usr/bin/env python3
"""Semantic embedding-based community detection + UMAP positioning for knowledge graph nodes.

Reads node embeddings from PostgreSQL, runs KMeans clustering with
automatic K selection via silhouette score, computes UMAP 2D coordinates,
and writes community_id + pca_x + pca_y back to the nodes table.

Designed to be run standalone or as part of the kg-reducer pipeline
(after normalize.py).

Usage:
    python scripts/cluster_nodes.py --dataset-id main
    python scripts/cluster_nodes.py --dataset-id main --dry-run
    python scripts/cluster_nodes.py --dataset-id main --seed 42 --fixed-k 8
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg.types import TypeInfo

from knowledge_store_common import (
    connect_db,
    ensure_pg_schema,
    ensure_community_id_column,
    resolve_dataset_id,
)


EMBEDDING_DIMENSION = 2560


def register_vector_type(connection: psycopg.Connection) -> None:
    """Register the pgvector type so psycopg3 can handle ::vector casts."""
    info = TypeInfo.fetch(connection, "vector")
    if info is not None:
        info.register(connection)


def parse_embedding(raw: object) -> list[float] | None:
    """Parse a pgvector value into a list of floats."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        cleaned = raw.strip().strip("[]")
        if not cleaned:
            return None
        return [float(x) for x in cleaned.split(",") if x.strip()]
    return None


def compute_optimal_k(
    embeddings: np.ndarray,
    k_min: int,
    k_max: int,
    seed: int,
) -> int:
    """Find the K with the best silhouette score in [k_min, k_max]."""
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    if k_min >= k_max:
        return k_min

    best_k = k_min
    best_score = -1.0

    for k in range(k_min, k_max + 1):
        km = KMeans(n_clusters=k, random_state=seed, n_init=10, max_iter=300)
        labels = km.fit_predict(embeddings)
        if len(set(labels)) < 2:
            continue
        sample = min(5000, len(embeddings))
        score = silhouette_score(embeddings, labels, sample_size=sample)
        if score > best_score:
            best_score = score
            best_k = k

    return best_k


def cluster_dataset(
    connection: psycopg.Connection,
    dataset_id: str,
    seed: int,
    fixed_k: int | None,
    dry_run: bool,
) -> dict:
    """Run KMeans clustering + PCA for a single dataset. Returns stats dict."""

    # 1. Fetch nodes with non-null embeddings
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, embedding FROM nodes "
            "WHERE dataset_id = %s AND embedding IS NOT NULL AND status != 'deprecated'",
            (dataset_id,),
        )
        rows = cur.fetchall()

    if not rows:
        print("  No nodes with embeddings found.")
        return {"total_nodes": 0, "clustered_nodes": 0, "k": 0}

    # 2. Parse embedding vectors
    node_ids: list[str] = []
    embeddings: list[list[float]] = []
    for row in rows:
        vec = parse_embedding(row["embedding"])
        if vec is not None and len(vec) == EMBEDDING_DIMENSION:
            node_ids.append(row["id"])
            embeddings.append(vec)

    n = len(node_ids)
    if n < 10:
        print(f"  Only {n} nodes with valid embeddings -- skipping clustering")
        return {"total_nodes": len(rows), "clustered_nodes": 0, "k": 0}

    X = np.array(embeddings, dtype=np.float32)

    # 3. Determine K and run KMeans first
    if fixed_k is not None:
        optimal_k = fixed_k
        print(f"  Using fixed K = {optimal_k}")
    else:
        k_min = max(2, int(n**0.5 / 7))
        k_max = min(20, n // 10)
        k_min = min(k_min, k_max)
        if k_min < 2:
            k_min = 2
        if k_max < k_min:
            k_max = k_min
        print(f"  Searching optimal K in [{k_min}, {k_max}] for {n} nodes...")
        optimal_k = compute_optimal_k(X, k_min, k_max, seed)

    print(f"  Optimal K = {optimal_k}")

    from sklearn.cluster import KMeans
    km = KMeans(n_clusters=optimal_k, random_state=seed, n_init=10, max_iter=300)
    labels = km.fit_predict(X)

    # 4. Compute layout: each cluster gets a sector center,
    #    nodes within each cluster use UMAP for local arrangement
    import umap

    print(f"  Computing UMAP(2) within each cluster for {n} nodes...")

    # Assign each cluster a center using golden-angle spiral
    GOLDEN_ANGLE = np.pi * (3 - np.sqrt(5))
    cluster_spread = np.sqrt(n) * 60  # distance between cluster centers
    cluster_centers = {}
    for idx in range(optimal_k):
        angle = idx * GOLDEN_ANGLE
        r = cluster_spread * np.sqrt((idx + 1) / optimal_k)
        cluster_centers[idx] = (r * np.cos(angle), r * np.sin(angle))

    # Run UMAP per-cluster for local coordinates, then offset to cluster center
    coords_2d = np.zeros((n, 2), dtype=np.float32)
    for cid in range(optimal_k):
        mask = labels == cid
        indices = np.where(mask)[0]
        cluster_emb = X[mask]
        cx, cy = cluster_centers[cid]
        member_count = len(indices)

        if member_count < 5:
            # Too few for UMAP — just spread in a small circle
            for j, idx in enumerate(indices):
                a = j * GOLDEN_ANGLE
                r = member_count * 8
                coords_2d[idx] = [cx + np.cos(a) * r, cy + np.sin(a) * r]
            continue

        # UMAP within this cluster for local structure
        local_reducer = umap.UMAP(
            n_components=2,
            n_neighbors=min(10, member_count - 1),
            min_dist=0.1,
            spread=1.5,
            metric='cosine',
            random_state=seed,
        )
        local_coords = local_reducer.fit_transform(cluster_emb)

        # Scale local coords to fit within a radius proportional to sqrt(member_count)
        local_max = np.max(np.abs(local_coords)) or 1.0
        local_scale = np.sqrt(member_count) * 30 / local_max
        local_coords = local_coords * local_scale

        # Offset to cluster center
        for j, idx in enumerate(indices):
            coords_2d[idx] = [cx + local_coords[j, 0], cy + local_coords[j, 1]]

    print(f"  Layout done. Range: x=[{coords_2d[:,0].min():.0f}, {coords_2d[:,0].max():.0f}], y=[{coords_2d[:,1].min():.0f}, {coords_2d[:,1].max():.0f}]")

    # 6. Print cluster sizes
    counts = Counter(labels.tolist())
    for cid, cnt in sorted(counts.items()):
        print(f"    Cluster {cid}: {cnt} nodes")

    if dry_run:
        return {
            "total_nodes": len(rows),
            "clustered_nodes": n,
            "k": optimal_k,
            "dry_run": True,
        }

    # 7. Write community_id + pca_x + pca_y back to PG
    with connection.cursor() as cur:
        # Reset all for this dataset
        cur.execute(
            "UPDATE nodes SET community_id = NULL, pca_x = NULL, pca_y = NULL "
            "WHERE dataset_id = %s",
            (dataset_id,),
        )
        # Batch update
        for node_id, community_id, (px, py) in zip(node_ids, labels, coords_2d):
            cur.execute(
                "UPDATE nodes SET community_id = %s, pca_x = %s, pca_y = %s "
                "WHERE dataset_id = %s AND id = %s",
                (int(community_id), float(px), float(py), dataset_id, node_id),
            )
    connection.commit()

    return {"total_nodes": len(rows), "clustered_nodes": n, "k": optimal_k}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Semantic clustering + PCA positioning of knowledge graph nodes"
    )
    parser.add_argument(
        "--dataset-id",
        default=None,
        help="Dataset ID (default: active dataset)",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="PostgreSQL connection URL (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--fixed-k",
        type=int,
        default=None,
        help="Use a fixed number of clusters instead of auto-detection",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show clustering results without writing to DB",
    )
    args = parser.parse_args()

    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    ensure_community_id_column(connection)
    register_vector_type(connection)

    dataset_id = resolve_dataset_id(connection, args.dataset_id)
    print(f"Clustering dataset: {dataset_id}")

    stats = cluster_dataset(connection, dataset_id, args.seed, args.fixed_k, args.dry_run)

    if stats.get("dry_run"):
        print(f"\n[DRY RUN] {stats['clustered_nodes']} nodes in {stats['k']} clusters (not written)")
    else:
        print(f"\nDone: {stats['clustered_nodes']} nodes in {stats['k']} clusters")

    connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
