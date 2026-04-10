#!/usr/bin/env python3
"""Shared embedding client for the local OpenAI-compatible embedding API."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_URL = "http://10.11.20.254:1234/v1/embeddings"
DEFAULT_EMBEDDING_MODEL = "text-embedding-bge-large-zh-v1.5"
EMBEDDING_DIMENSION = 1024


def embed_texts(
    texts: list[str],
    *,
    url: str = DEFAULT_EMBEDDING_URL,
    model: str = DEFAULT_EMBEDDING_MODEL,
    max_retries: int = 3,
    retry_delay: float = 2.0,
    timeout: float = 30.0,
) -> list[list[float]]:
    """Embed a batch of texts via the local OpenAI-compatible API.

    Returns a list of embedding vectors (one per input text).
    On unrecoverable failure, returns empty lists for each input
    so the pipeline can continue without embeddings.
    """
    empty_result: list[list[float]] = [[] for _ in texts]

    if not texts:
        return []

    payload = json.dumps({"model": model, "input": texts}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))

            data = body.get("data", [])

            # Build results indexed by API-returned index so we can handle
            # partial failures (one bad vector doesn't discard the rest).
            indexed: dict[int, list[float]] = {}
            for item in data:
                idx = item.get("index", 0)
                vec = item.get("embedding", [])
                if len(vec) != EMBEDDING_DIMENSION:
                    logger.warning(
                        "Embedding index %d: unexpected dimension %d (expected %d) — skipping",
                        idx,
                        len(vec),
                        EMBEDDING_DIMENSION,
                    )
                    continue
                indexed[idx] = vec

            if not indexed:
                logger.warning(
                    "Embedding API returned 0 valid vectors for %d inputs",
                    len(texts),
                )
                return empty_result

            # Assemble in input order; missing entries get [].
            results: list[list[float]] = [indexed.get(i, []) for i in range(len(texts))]
            missing = [i for i, v in enumerate(results) if not v]
            if missing:
                logger.warning(
                    "Embedding API: %d/%d vectors missing or invalid (indices: %s)",
                    len(missing),
                    len(texts),
                    missing[:10],
                )
            return results

        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last_error = exc
            if attempt < max_retries:
                delay = retry_delay * (2 ** (attempt - 1))
                logger.warning(
                    "Embedding API call failed (attempt %d/%d): %s — retrying in %.1fs",
                    attempt,
                    max_retries,
                    exc,
                    delay,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Embedding API call failed after %d attempts: %s",
                    max_retries,
                    exc,
                )

        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.error("Embedding API returned invalid response: %s", exc)
            return empty_result

    return empty_result


def embed_single(
    text: str,
    **kwargs: Any,
) -> list[float]:
    """Embed a single text string. Returns one embedding vector."""
    results = embed_texts([text], **kwargs)
    return results[0] if results else []
