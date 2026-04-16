#!/usr/bin/env python3
"""Shared embedding client for the OpenAI-compatible embedding API."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_URL = "https://heckb8bcaq88cko9mooamhkbceqq9ecc.openapi-sj.sii.edu.cn/v1/embeddings"
DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B"
EMBEDDING_DIMENSION = 2560


def embed_texts(
    texts: list[str],
    *,
    url: str = DEFAULT_EMBEDDING_URL,
    model: str = DEFAULT_EMBEDDING_MODEL,
    api_key: str | None = None,
    max_retries: int = 3,
    retry_delay: float = 2.0,
    timeout: float = 30.0,
) -> list[list[float]]:
    """Embed a batch of texts via the OpenAI-compatible API.

    Returns a list of embedding vectors (one per input text).
    On unrecoverable failure, returns empty lists for each input
    so the pipeline can continue without embeddings.
    """
    empty_result: list[list[float]] = [[] for _ in texts]

    if not texts:
        return []

    resolved_key = api_key or os.environ.get("EMBEDDING_API_KEY", "")
    request_body: dict[str, Any] = {"model": model, "input": texts}
    payload = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if resolved_key:
        headers["Authorization"] = f"Bearer {resolved_key}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers=headers,
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
                if not vec:
                    continue
                # If API returns more dimensions than target, truncate (MRL-compatible).
                # If API returns fewer, skip — unexpected.
                if len(vec) > EMBEDDING_DIMENSION:
                    vec = vec[:EMBEDDING_DIMENSION]
                elif len(vec) < EMBEDDING_DIMENSION:
                    logger.warning(
                        "Embedding index %d: dimension %d < expected %d — skipping",
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
