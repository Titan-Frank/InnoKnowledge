import { useEffect, useRef, useState } from 'react';
import { loadUnit } from '@/services/backend-client';
import { useAppState } from './useAppState';
import type { ApiUnit } from '@okm/types';
import type { OKMNode } from '@/core/graph/types';

const unitCache = new Map<string, ApiUnit | null>();

export function useUnitLoader(node: OKMNode | null) {
  const [unit, setUnit] = useState<ApiUnit | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const { selectedSourceKey } = useAppState();

  useEffect(() => {
    if (!node || !selectedSourceKey) {
      setUnit(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${selectedSourceKey}:${node.id}`;
    const requestId = ++requestIdRef.current;
    if (unitCache.has(cacheKey)) {
      setUnit(unitCache.get(cacheKey) ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadUnit(selectedSourceKey, node.id)
      .then((payload) => {
        if (requestId !== requestIdRef.current) return;
        unitCache.set(cacheKey, payload);
        setUnit(payload);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        unitCache.set(cacheKey, null);
        setUnit(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [node?.id, selectedSourceKey]);

  return { unit, loading };
}
