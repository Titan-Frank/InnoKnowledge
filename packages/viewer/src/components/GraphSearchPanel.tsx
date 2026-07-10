import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  GroundedGenerationResponse,
  UnitRetrievalHit,
  UnitRetrievalMode,
  UnitRetrievalResponse,
} from '@okm/types';
import type { SearchHitMeta } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { generateGroundedAnswer, searchApiUnits } from '@/services/backend-client';
import { resolveExpandedBackboneNodeId } from '@/lib/visibility';
import { MarkdownView } from '@/components/MarkdownView';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  MessageSquareText,
  Network,
  Search,
  X,
} from '@/lib/lucide-icons';

const MODE_OPTIONS: Array<{ value: UnitRetrievalMode; label: string }> = [
  { value: 'hybrid', label: '混合' },
  { value: 'text', label: '文本' },
  { value: 'vector', label: '向量' },
];

const SUGGESTED_QUERIES = ['什么是光子？', '静电场', '电容触摸屏'];

const DEFAULT_QUERY = '';

export function GraphSearchPanel() {
  const {
    selectedSourceKey,
    knowledgeGraph,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId,
    setSelectedNodeId,
    setExpandedBackboneNodeId,
    setHoverNodeId,
    setSearchTerm,
    setServerSearchHits,
  } = useAppState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [mode, setMode] = useState<UnitRetrievalMode>('hybrid');
  const [limit, setLimit] = useState(8);
  const [retrieval, setRetrieval] = useState<UnitRetrievalResponse | null>(null);
  const [generation, setGeneration] = useState<GroundedGenerationResponse | null>(null);
  const [loading, setLoading] = useState<'search' | 'generate' | null>(null);
  const [error, setError] = useState('');
  const activeSourceKeyRef = useRef(selectedSourceKey);
  const queryInputRef = useRef<HTMLInputElement>(null);

  const hasQuery = Boolean(query.trim());
  const actionDisabled = !selectedSourceKey || loading !== null || !hasQuery;
  const status = useMemo(
    () => generation ? groundingStatusLabel(generation.grounding.status) : null,
    [generation],
  );
  const usedNodeIds = useMemo(() => new Set(generation?.used_node_ids ?? []), [generation]);
  const citationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const citation of generation?.citations ?? []) {
      counts.set(citation.node_id, (counts.get(citation.node_id) ?? 0) + 1);
    }
    return counts;
  }, [generation]);

  useEffect(() => {
    activeSourceKeyRef.current = selectedSourceKey;
    setRetrieval(null);
    setGeneration(null);
    setLoading(null);
    setError('');
    setSearchTerm('');
    setServerSearchHits(new Map());
    setHoverNodeId(null);
  }, [selectedSourceKey, setHoverNodeId, setSearchTerm, setServerSearchHits]);

  function resetPublishedResults() {
    setRetrieval(null);
    setGeneration(null);
    setError('');
    setSearchTerm('');
    setServerSearchHits(new Map());
    setHoverNodeId(null);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (retrieval || generation || error) {
      resetPublishedResults();
    }
  }

  function handleModeChange(value: UnitRetrievalMode) {
    setMode(value);
    if (retrieval || generation || error) {
      resetPublishedResults();
    }
  }

  function handleLimitChange(value: number) {
    setLimit(clampLimit(value));
    if (retrieval || generation || error) {
      resetPublishedResults();
    }
  }

  function publishHits(response: UnitRetrievalResponse, activeQuery: string) {
    const hits = new Map<string, SearchHitMeta>();
    for (const hit of response.hits) {
      hits.set(hit.node_id, {
        score: hit.score,
        text_match: hit.text_match,
        vector_match: hit.vector_match,
        similarity: hit.similarity,
      });
    }
    setSearchTerm(activeQuery);
    setServerSearchHits(hits);
  }

  async function runSearch(activeQuery: string) {
    if (!selectedSourceKey || !activeQuery.trim()) return;
    const activeSourceKey = selectedSourceKey;
    const normalizedQuery = activeQuery.trim();
    setLoading('search');
    setError('');
    setGeneration(null);
    try {
      const response = await searchApiUnits(activeSourceKey, normalizedQuery, limit, mode);
      if (activeSourceKeyRef.current !== activeSourceKey) return;
      setRetrieval(response);
      publishHits(response, normalizedQuery);
    } catch (err) {
      if (activeSourceKeyRef.current !== activeSourceKey) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeSourceKeyRef.current === activeSourceKey) setLoading(null);
    }
  }

  async function handleSearch(event?: FormEvent) {
    event?.preventDefault();
    await runSearch(query);
  }

  function handleSuggestion(value: string) {
    setQuery(value);
    queryInputRef.current?.focus();
    void runGenerate(value);
  }

  async function runGenerate(activeQueryValue: string) {
    if (!selectedSourceKey || !activeQueryValue.trim()) return;
    const activeSourceKey = selectedSourceKey;
    const activeQuery = activeQueryValue.trim();
    setLoading('generate');
    setError('');
    try {
      const response = await generateGroundedAnswer(activeSourceKey, {
        question: activeQuery,
        limit,
        retrieval_mode: mode,
      });
      if (activeSourceKeyRef.current !== activeSourceKey) return;
      setRetrieval(response.retrieval);
      setGeneration(response);
      publishHits(response.retrieval, activeQuery);
    } catch (err) {
      if (activeSourceKeyRef.current !== activeSourceKey) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (activeSourceKeyRef.current === activeSourceKey) setLoading(null);
    }
  }

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    await runGenerate(query);
  }

  function clearSearch() {
    setQuery('');
    setRetrieval(null);
    setGeneration(null);
    setError('');
    setSearchTerm('');
    setServerSearchHits(new Map());
    setHoverNodeId(null);
  }

  function focusNode(nodeId: string) {
    if (knowledgeGraph && layerMode === 'backbone-expand') {
      const backboneNodeId = resolveExpandedBackboneNodeId(nodeId, {
        knowledgeGraph,
        selectedTypes,
        selectedBook,
        layerMode,
        expandedBackboneNodeId,
        focusConnected: false,
        selectedNodeId: nodeId,
        searchTerm: '',
        serverSearchHits: new Map(),
      });
      if (backboneNodeId) setExpandedBackboneNodeId(backboneNodeId);
    }
    setSelectedNodeId(nodeId);
    setHoverNodeId(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="okm-assistant-trigger absolute bottom-4 left-4 z-30 flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border-subtle bg-elevated/95 px-3 text-xs font-semibold text-text-primary shadow-panel backdrop-blur transition-colors hover:bg-hover"
        aria-label="打开检索浮窗"
      >
        <MessageSquareText className="h-4 w-4 text-accent" />
        <span>{retrieval ? `${retrieval.hits.length} 个命中` : '问知识地图'}</span>
        <span className="okm-live-dot" aria-hidden="true" />
      </button>
    );
  }

  return (
    <section className="okm-assistant-panel absolute bottom-3 left-3 right-3 z-30 flex max-h-[78vh] animate-slide-up flex-col overflow-hidden rounded-lg border border-border-subtle bg-elevated/98 shadow-panel backdrop-blur sm:bottom-4 sm:left-4 sm:right-auto sm:w-[30rem]">
      <header className="flex min-h-11 items-center justify-between border-b border-border-subtle bg-surface px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/35 bg-accent/10 text-accent">
            <MessageSquareText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-primary">问知识地图</h2>
            {retrieval && (
              <p className="truncate text-[11px] text-text-muted">
                {retrieval.hits.length} 个命中 · {modeLabel(retrieval)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="清空检索"
              title="清空"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            aria-label="收起检索浮窗"
            title="收起"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </header>

      <form onSubmit={handleGenerate} className="border-b border-border-subtle bg-elevated p-3">
        <label htmlFor="graph-search-query" className="mb-1 block text-[11px] font-medium text-text-muted">
          问题或知识对象
        </label>
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 transition-colors focus-within:border-accent focus-within:shadow-glow-soft">
          <Search className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            id="graph-search-query"
            ref={queryInputRef}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="例如：什么是光子？"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
        </div>

        {!hasQuery && !retrieval && (
          <SuggestionChips options={SUGGESTED_QUERIES} onSelect={handleSuggestion} />
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex h-8 overflow-hidden rounded-md border border-border-subtle bg-surface p-0.5">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleModeChange(option.value)}
                  className={`cursor-pointer rounded px-2.5 text-xs transition-colors ${
                    mode === option.value ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                  }`}
                  aria-pressed={mode === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-surface px-2 text-xs text-text-secondary">
              数量
              <input
                type="number"
                min={1}
                max={30}
                value={limit}
                onChange={(event) => handleLimitChange(Number(event.target.value))}
                className="w-10 bg-transparent text-right text-text-primary outline-none"
                aria-label="检索数量"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={actionDisabled}
            className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted"
          >
            {loading === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
            生成回答
          </button>
        </div>

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={actionDisabled}
            onClick={() => void handleSearch()}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted"
          >
            {loading === 'search' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            只看命中对象
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 px-2.5 py-2 text-xs leading-5 text-node-event">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {generation && (
          <AnswerSection
            generation={generation}
            retrieval={retrieval}
            status={status}
            onFocusNode={focusNode}
            onPreviewNode={setHoverNodeId}
          />
        )}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                <Network className="h-3.5 w-3.5" />
                命中对象
              </h3>
              {retrieval && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <ResultPill label={`${retrieval.hits.length} 个命中`} />
                  <ResultPill label={modeLabel(retrieval)} />
                  <ResultPill label={`返回 ${limit}`} />
                </div>
              )}
            </div>
            {retrieval && (
              <button
                type="button"
                disabled={actionDisabled}
                onClick={() => void handleGenerate()}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted"
              >
                {loading === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
                {generation ? '重新回答' : '生成回答'}
              </button>
            )}
          </div>

          {!retrieval ? (
            <EmptyState label="等待检索" />
          ) : retrieval.hits.length === 0 ? (
            <EmptyState label="没有命中对象">
              <div className="mt-2 text-[11px] text-text-muted">可以减少关键词，或切换到文本检索</div>
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {retrieval.hits.map((hit, index) => (
                <UnitHitItem
                  key={hit.node_id}
                  hit={hit}
                  index={index}
                  isUsedInAnswer={usedNodeIds.has(hit.node_id)}
                  citationCount={citationCounts.get(hit.node_id) ?? 0}
                  onOpen={() => focusNode(hit.node_id)}
                  onPreview={(active) => setHoverNodeId(active ? hit.node_id : null)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function AnswerSection({
  generation,
  retrieval,
  status,
  onFocusNode,
  onPreviewNode,
}: {
  generation: GroundedGenerationResponse;
  retrieval: UnitRetrievalResponse | null;
  status: { label: string; ok: boolean } | null;
  onFocusNode: (nodeId: string) => void;
  onPreviewNode: (nodeId: string | null) => void;
}) {
  const relatedHits = generation.used_node_ids
    .map((nodeId) => retrieval?.hits.find((hit) => hit.node_id === nodeId))
    .filter((hit): hit is UnitRetrievalHit => Boolean(hit));

  return (
    <section className="mb-4 rounded-md border border-border-subtle bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-secondary">回答</h3>
        {status && (
          <span className={`flex items-center gap-1 text-[11px] ${status.ok ? 'text-node-process' : 'text-node-method'}`}>
            {status.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {status.label}
          </span>
        )}
      </div>
      <MarkdownView content={generation.answer} className="text-xs leading-6 text-text-primary" />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="有效引用" value={generation.grounding.valid_citation_count} />
        <Metric label="使用对象" value={generation.used_node_ids.length} />
      </div>

      {relatedHits.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-medium text-text-muted">关联对象</h4>
          <div className="flex flex-wrap gap-1.5">
            {relatedHits.map((hit) => (
              <button
                key={hit.node_id}
                type="button"
                onClick={() => onFocusNode(hit.node_id)}
                onMouseEnter={() => onPreviewNode(hit.node_id)}
                onMouseLeave={() => onPreviewNode(null)}
                className="max-w-full cursor-pointer rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-left text-[11px] text-accent transition-colors hover:bg-accent/15"
              >
                <span className="block max-w-[12rem] truncate">{hit.unit.node.name || hit.canonical_name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {generation.citations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <h4 className="text-[11px] font-medium text-text-muted">引用</h4>
          {generation.citations.map((citation) => (
            <button
              key={`${citation.node_id}:${citation.evidence_id}`}
              type="button"
              onClick={() => onFocusNode(citation.node_id)}
              onMouseEnter={() => onPreviewNode(citation.node_id)}
              onMouseLeave={() => onPreviewNode(null)}
              className="block w-full cursor-pointer rounded-md border border-border-subtle bg-elevated px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-hover"
            >
              <div className="break-all font-mono text-[11px] text-accent">{citation.node_id}</div>
              <div className="mt-0.5 break-all font-mono text-[10px] text-text-muted">{citation.evidence_id}</div>
              {citation.note && <p className="mt-1 text-xs leading-5 text-text-secondary">{citation.note}</p>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function UnitHitItem({
  hit,
  index,
  isUsedInAnswer,
  citationCount,
  onOpen,
  onPreview,
}: {
  hit: UnitRetrievalHit;
  index: number;
  isUsedInAnswer: boolean;
  citationCount: number;
  onOpen: () => void;
  onPreview: (active: boolean) => void;
}) {
  const node = hit.unit.node;
  const definition = node.definition || compactText(hit.unit.body?.content || hit.unit.card?.summary || '');
  return (
    <article
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      className={`okm-result-card rounded-md border bg-surface p-2.5 transition-colors hover:border-accent/40 hover:bg-hover ${
        isUsedInAnswer ? 'border-accent/45' : 'border-border-subtle'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-text-muted">#{index + 1}</span>
            <h4 className="truncate text-sm font-semibold text-text-primary">{node.name || hit.canonical_name}</h4>
          </div>
          <div className="mt-0.5 break-all font-mono text-[10px] text-text-muted">{hit.node_id}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isUsedInAnswer && (
            <span className="rounded-md border border-accent/25 bg-accent/10 px-1.5 py-1 text-[10px] text-accent">
              已关联{citationCount > 0 ? ` ${citationCount}` : ''}
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer rounded-md border border-accent/25 bg-accent/10 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/15"
          >
            定位
          </button>
        </div>
      </div>

      {definition && <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary">{definition}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
        <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5">{hit.node_kind}</span>
        <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5">分数 {formatScore(hit.score)}</span>
        <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5">证据 {hit.unit.evidence.length}</span>
        <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5">
          完整度 {Math.round((hit.unit.completeness?.score ?? 0) * 100)}%
        </span>
      </div>

      {hit.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {hit.reasons.map((reason) => (
            <span key={reason} className="rounded bg-hover px-1.5 py-0.5 text-[10px] text-text-secondary">
              {reason}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface px-2.5 py-1.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function ResultPill({ label }: { label: string }) {
  return (
    <span className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
      {label}
    </span>
  );
}

function SuggestionChips({
  options,
  onSelect,
  compact = false,
}: {
  options: string[];
  onSelect: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? 'mt-3 justify-center' : 'mt-2'} flex flex-wrap gap-1.5`}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelect(option)}
          className="cursor-pointer rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:bg-hover hover:text-text-primary"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border-default bg-surface px-3 py-5 text-center text-xs text-text-muted">
      {label}
      {children}
    </div>
  );
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.min(Math.max(Math.trunc(value), 1), 30);
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function modeLabel(response: UnitRetrievalResponse): string {
  if (response.requested_mode === 'vector') return response.mode === 'full' ? '向量' : '文本回退';
  if (response.requested_mode === 'hybrid') return response.mode === 'full' ? '混合' : '文本回退';
  return '文本';
}

function groundingStatusLabel(value: GroundedGenerationResponse['grounding']['status']): { label: string; ok: boolean } {
  switch (value) {
    case 'grounded':
      return { label: '引用有效', ok: true };
    case 'partial':
      return { label: '部分有效', ok: false };
    case 'model_error':
      return { label: '模型失败', ok: false };
    case 'insufficient_context':
    default:
      return { label: '依据不足', ok: false };
  }
}
