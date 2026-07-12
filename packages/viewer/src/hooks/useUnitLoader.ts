import { useEffect, useRef, useState } from 'react';
import { loadUnit } from '@/services/backend-client';
import { useAppState } from './useAppState';
import type { ApiUnit } from '@okm/types';
import type { OKMNode } from '@/core/graph/types';

const unitCache = new Map<string, ApiUnit | null>();
const UNIT_CACHE_INVALIDATED_EVENT = 'okm:unit-cache-invalidated';

export function invalidateUnitCache(sourceKey?: string): void {
  if (sourceKey) {
    const prefix = `${sourceKey}:`;
    for (const key of unitCache.keys()) {
      if (key.startsWith(prefix)) unitCache.delete(key);
    }
  } else {
    unitCache.clear();
  }
  window.dispatchEvent(new CustomEvent(UNIT_CACHE_INVALIDATED_EVENT, { detail: { sourceKey: sourceKey ?? '' } }));
}

export function useUnitLoader(node: OKMNode | null) {
  const [unit, setUnit] = useState<ApiUnit | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestIdRef = useRef(0);
  const { selectedSourceKey } = useAppState();

  useEffect(() => {
    const handleInvalidation = (event: Event) => {
      const invalidatedSource = (event as CustomEvent<{ sourceKey?: string }>).detail?.sourceKey ?? '';
      if (!invalidatedSource || invalidatedSource === selectedSourceKey) {
        setRefreshVersion((current) => current + 1);
      }
    };
    window.addEventListener(UNIT_CACHE_INVALIDATED_EVENT, handleInvalidation);
    return () => window.removeEventListener(UNIT_CACHE_INVALIDATED_EVENT, handleInvalidation);
  }, [selectedSourceKey]);

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
        setUnit(null);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [node?.id, selectedSourceKey, refreshVersion]);

  return { unit, loading };
}
