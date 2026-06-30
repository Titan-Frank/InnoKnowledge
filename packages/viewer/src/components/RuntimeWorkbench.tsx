import { useMemo, useState, type FormEvent } from 'react';
import type {
  GroundedGenerationResponse,
  UnitRetrievalHit,
  UnitRetrievalMode,
  UnitRetrievalResponse,
} from '@okm/types';
import { useAppState } from '@/hooks/useAppState';
import { generateGroundedAnswer, searchApiUnits } from '@/services/backend-client';
import { AlertCircle, Check, Loader2, MessageSquareText, Search } from '@/lib/lucide-icons';

const MODE_OPTIONS: Array<{ value: UnitRetrievalMode; label: string }> = [
  { value: 'hybrid', label: '混合' },
  { value: 'text', label: '文本' },
  { value: 'vector', label: '向量' },
];

const DEFAULT_QUERY = '什么是光子？';

export function RuntimeWorkbench() {
  const { selectedSourceKey, setSelectedNodeId, setWorkspace } = useAppState();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [mode, setMode] = useState<UnitRetrievalMode>('text');
  const [limit, setLimit] = useState(5);
  const [retrieval, setRetrieval] = useState<UnitRetrievalResponse | null>(null);
  const [generation, setGeneration] = useState<GroundedGenerationResponse | null>(null);
  const [loading, setLoading] = useState<'search' | 'generate' | null>(null);
  const [error, setError] = useState('');

  const disabled = !selectedSourceKey || loading !== null || !query.trim();
  const status = useMemo(() => generation ? groundingStatusLabel(generation.grounding.status) : null, [generation]);

  async function handleSearch(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedSourceKey || !query.trim()) return;
    setLoading('search');
    setError('');
    setGeneration(null);
    try {
      const response = await searchApiUnits(selectedSourceKey, query.trim(), limit, mode);
      setRetrieval(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleGenerate() {
    if (!selectedSourceKey || !query.trim()) return;
    setLoading('generate');
    setError('');
    try {
      const response = await generateGroundedAnswer(selectedSourceKey, {
        question: query.trim(),
        limit,
        retrieval_mode: mode,
      });
      setRetrieval(response.retrieval);
      setGeneration(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  function openUnit(nodeId: string) {
    setSelectedNodeId(nodeId);
    setWorkspace('graph');
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-void">
      <section className="border-b border-border-subtle bg-surface px-4 py-3">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 border border-border-subtle bg-elevated px-3">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入问题或知识对象"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 border border-border-subtle bg-elevated">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  className={`px-3 text-xs transition-colors ${
                    mode === option.value ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="flex h-10 items-center gap-2 border border-border-subtle bg-elevated px-3 text-xs text-text-secondary">
              数量
              <input
                type="number"
                min={1}
                max={30}
                value={limit}
                onChange={(event) => setLimit(clampLimit(Number(event.target.value)))}
                className="w-12 bg-transparent text-right text-text-primary outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={disabled}
              className="flex h-10 items-center gap-2 bg-elevated px-3 text-xs text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
            >
              {loading === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              检索对象
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={handleGenerate}
              className="flex h-10 items-center gap-2 bg-accent px-3 text-xs text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-elevated disabled:text-text-muted"
            >
              {loading === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
              生成回答
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-3 flex items-center gap-2 border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-border-subtle p-4 scrollbar-thin">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">对象检索</h2>
            {retrieval && (
              <span className="text-xs text-text-muted">
                {retrieval.hits.length} 个对象 · {modeLabel(retrieval.mode)}
              </span>
            )}
          </div>

          {!retrieval ? (
            <EmptyState label="等待检索" />
          ) : retrieval.hits.length === 0 ? (
            <EmptyState label="没有命中对象" />
          ) : (
            <div className="space-y-2">
              {retrieval.hits.map((hit, index) => (
                <UnitHitItem
                  key={hit.node_id}
                  hit={hit}
                  index={index}
                  onOpen={() => openUnit(hit.node_id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">生成结果</h2>
            {status && (
              <span className={`flex items-center gap-1 text-xs ${status.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                {status.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {status.label}
              </span>
            )}
          </div>

          {!generation ? (
            <EmptyState label="等待生成" />
          ) : (
            <div className="space-y-4">
              <div className="border border-border-subtle bg-surface p-4">
                <p className="whitespace-pre-wrap text-sm leading-7 text-text-primary">{generation.answer}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <Metric label="有效引用" value={generation.grounding.valid_citation_count} />
                <Metric label="无效引用" value={generation.grounding.invalid_citation_count} />
                <Metric label="使用对象" value={generation.used_node_ids.length} />
                <Metric label="未支撑声明" value={generation.unsupported_claims.length} />
              </div>

              <section>
                <h3 className="mb-2 text-xs font-semibold text-text-secondary">引用</h3>
                {generation.citations.length ? (
                  <div className="space-y-2">
                    {generation.citations.map((citation) => (
                      <div key={`${citation.node_id}:${citation.evidence_id}`} className="border border-border-subtle bg-elevated px-3 py-2">
                        <div className="break-all font-mono text-[11px] text-text-primary">{citation.evidence_id}</div>
                        <button
                          type="button"
                          onClick={() => openUnit(citation.node_id)}
                          className="mt-1 break-all text-left font-mono text-[11px] text-accent hover:underline"
                        >
                          {citation.node_id}
                        </button>
                        {citation.note && <p className="mt-1 text-xs text-text-secondary">{citation.note}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState label="没有引用" compact />
                )}
              </section>

              {generation.grounding.invalid_citations.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-amber-300">无效引用</h3>
                  <div className="space-y-2">
                    {generation.grounding.invalid_citations.map((citation, index) => (
                      <div key={`${citation.node_id}:${citation.evidence_id}:${index}`} className="border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                        <div className="break-all font-mono">{citation.evidence_id || '缺少证据编号'}</div>
                        <div className="mt-1 break-all font-mono">{citation.node_id || '缺少对象编号'}</div>
                        <div className="mt-1">{citation.reason}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function UnitHitItem({ hit, index, onOpen }: { hit: UnitRetrievalHit; index: number; onOpen: () => void }) {
  const node = hit.unit.node;
  const definition = node.definition || hit.unit.card?.summary || '';
  return (
    <article className="border border-border-subtle bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">#{index + 1}</span>
            <h3 className="truncate text-sm font-semibold text-text-primary">{node.name || hit.canonical_name}</h3>
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-text-muted">{hit.node_id}</div>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 text-xs text-accent hover:underline">
          查看
        </button>
      </div>

      {definition && <p className="mt-2 line-clamp-3 text-xs leading-5 text-text-secondary">{definition}</p>}

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
        <span className="border border-border-subtle px-2 py-0.5">{hit.node_kind}</span>
        <span className="border border-border-subtle px-2 py-0.5">分数 {formatScore(hit.score)}</span>
        <span className="border border-border-subtle px-2 py-0.5">证据 {hit.unit.evidence.length}</span>
        <span className="border border-border-subtle px-2 py-0.5">完整度 {Math.round((hit.unit.completeness?.score ?? 0) * 100)}%</span>
      </div>

      {hit.reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {hit.reasons.map((reason) => (
            <span key={reason} className="bg-hover px-1.5 py-0.5 text-[10px] text-text-secondary">{reason}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border-subtle bg-surface px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`border border-dashed border-border-subtle text-center text-xs text-text-muted ${compact ? 'px-3 py-4' : 'px-4 py-10'}`}>
      {label}
    </div>
  );
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(Math.max(Math.trunc(value), 1), 30);
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

function modeLabel(value: string): string {
  return value === 'full' ? '完整模式' : '文本模式';
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
