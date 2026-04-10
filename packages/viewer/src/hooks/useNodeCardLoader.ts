import { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { loadNodeCard } from '../api/index.js';
import type { ApiNodeCard } from '@okm/types';
import type { GraphNode } from '../store/types.js';

export function useNodeCardLoader(node: GraphNode | null) {
  const [card, setCard] = useState<ApiNodeCard | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!node) {
      setCard(null);
      setLoading(false);
      return;
    }

    const store = useGraphStore.getState();
    const requestId = ++requestIdRef.current;

    // Check cache
    if (store.cardCache.has(node.id)) {
      setCard(store.cardCache.get(node.id) ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const nodeCardPath =
      store.data?.source?.nodeCardPath ||
      `/api/source/${encodeURIComponent(store.selectedSourceKey || '')}/node-card`;

    loadNodeCard(nodeCardPath, node.id)
      .then((rawCard) => {
        if (requestId !== requestIdRef.current) return;
        useGraphStore.getState().cardCache.set(node.id, rawCard);
        setCard(rawCard);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setCard(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [node?.id]);

  return { card, loading };
}
