import { useState, useEffect, useRef } from 'react';
import { useAppState } from './useAppState';
import { loadNodeCard } from '@/services/backend-client';
import type { ApiNodeCard } from '@okm/types';
import type { OKMNode } from '@/core/graph/types';

export function useNodeCardLoader(node: OKMNode | null) {
  const [card, setCard] = useState<ApiNodeCard | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const { cardCache, selectedSourceKey, knowledgeGraph, setCardCache } = useAppState();

  useEffect(() => {
    if (!node) {
      setCard(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;

    if (cardCache.has(node.id)) {
      setCard(cardCache.get(node.id) ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const nodeCardPath =
      knowledgeGraph?.source?.nodeCardPath ||
      `/api/source/${encodeURIComponent(selectedSourceKey || '')}/node-card`;

    loadNodeCard(nodeCardPath, node.id)
      .then((rawCard) => {
        if (requestId !== requestIdRef.current) return;
        const newCache = new Map(cardCache);
        newCache.set(node.id, rawCard);
        setCardCache(newCache);
        setCard(rawCard);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setCard(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { card, loading };
}
