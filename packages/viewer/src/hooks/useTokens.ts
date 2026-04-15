import { useGraphStore } from '../store/graphStore.js';
import { getTokens, type TokenSet } from '../components/aiwc/styles/tokens.js';

export function useTokens(): TokenSet {
  const themeMode = useGraphStore((s) => s.themeMode);
  return getTokens(themeMode);
}
