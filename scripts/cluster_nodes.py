#!/usr/bin/env python3
"""Cluster world_nodes by embedding and write layout fields into properties_json."""

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

from knowledge_store_common import connect_db, ensure_pg_schema, resolve_dataset_id

EMBEDDING_DIMENSION = 2560


def register_vector_type(connection: psycopg.Connection) -> None:
    info = TypeInfo.fetch(connection, "vector")
    if info is not None:
        info.register(connection)


def parse_embedding(raw: object) -> list[float] | None:
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


def cluster_dataset(connection: psycopg.Connection, dataset_id: str, seed: int, fixed_k: int | None, dry_run: bool) -> dict:
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT id, embedding, properties_json FROM world_nodes WHERE dataset_id = %s AND embedding IS NOT NULL AND status != 'deprecated'",
            (dataset_id,),
        )
        rows = cur.fetchall()
    node_ids, embeddings, properties = [], [], []
    for row in rows:
        vec = parse_embedding(row["embedding"])
        if vec is not None and len(vec) == EMBEDDING_DIMENSION:
            node_ids.append(row["id"])
            embeddings.append(vec)
            properties.append(row["properties_json"] or {})
    n = len(node_ids)
    if n < 10:
        return {"total_nodes": len(rows), "clustered_nodes": 0, "k": 0}
    X = np.array(embeddings, dtype=np.float32)
    from sklearn.cluster import KMeans
    optimal_k = fixed_k or max(2, min(12, n // 15 or 2))
    km = KMeans(n_clusters=optimal_k, random_state=seed, n_init=10, max_iter=300)
    labels = km.fit_predict(X)
    from sklearn.decomposition import PCA
    coords = PCA(n_components=2, random_state=seed).fit_transform(X)
    if dry_run:
        return {"total_nodes": len(rows), "clustered_nodes": n, "k": optimal_k}
    with connection.cursor() as cur:
        for node_id, community_id, (px, py), props in zip(node_ids, labels, coords, properties):
            props = dict(props or {})
            props["community_id"] = int(community_id)
            props["layout"] = {"x": float(px), "y": float(py)}
            cur.execute(
                "UPDATE world_nodes SET properties_json = %s::jsonb WHERE dataset_id = %s AND id = %s",
                (__import__("json").dumps(props, ensure_ascii=False), dataset_id, node_id),
            )
    connection.commit()
    counts = Counter(labels.tolist())
    return {"total_nodes": len(rows), "clustered_nodes": n, "k": optimal_k, "cluster_sizes": dict(counts)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Cluster world knowledge nodes.")
    parser.add_argument("--dataset-id", default=None)
    parser.add_argument("--db", default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--fixed-k", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    db_url = args.db or os.environ.get("DATABASE_URL")
    connection = connect_db(db_url)
    ensure_pg_schema(connection)
    register_vector_type(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, None)
    result = cluster_dataset(connection, dataset_id, args.seed, args.fixed_k, args.dry_run)
    print(__import__("json").dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
