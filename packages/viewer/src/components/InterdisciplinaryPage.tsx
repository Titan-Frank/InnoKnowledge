import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ACTIVE_EDGE_TYPES,
  type ActiveEdgeType,
  type InterdisciplinaryCandidate,
  type InterdisciplinaryCandidateKind,
  type InterdisciplinaryCandidateStatus,
  type InterdisciplinaryOverviewResponse,
  type InterdisciplinaryReviewRequest,
} from '@okm/types';
import { useAppState } from '@/hooks/useAppState';
import {
  analyzeInterdisciplinaryGraph,
  applyInterdisciplinaryCandidates,
  loadInterdisciplinaryOverview,
  reviewInterdisciplinaryCandidate,
} from '@/services/backend-client';
import {
  candidateKindLabel,
  candidateMatchesDomainPair,
  candidateStatusLabel,
  domainLabel,
  relationTypeLabel,
  reviewReadiness,
} from '@/lib/interdisciplinary';
import { TYPE_META } from '@/lib/constants';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Check,
  Filter,
  GitBranch,
  Loader2,
  Network,
  Play,
  RotateCcw,
  X,
} from '@/lib/lucide-icons';

type StatusFilter = InterdisciplinaryCandidateStatus | 'all';
type KindFilter = InterdisciplinaryCandidateKind | 'all';
type DomainPairFilter = { source: string; target: string } | null;
type RelationDirection = 'undirected' | 'forward' | 'reverse';
type BridgePathReview = {
  relationTypes: ActiveEdgeType[];
  directions: Array<'directed' | 'undirected'>;
  evidenceIds: string[][];
};

const REVIEWABLE_RELATION_TYPES = ACTIVE_EDGE_TYPES;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'pending', label: '待审核' },
  { id: 'approved', label: '已批准' },
  { id: 'applied', label: '已写入' },
  { id: 'rejected', label: '已拒绝' },
  { id: 'all', label: '全部' },
];

const METHOD_LABELS: Record<string, string> = {
  cross_domain_identity_alignment: '跨学科同一对象对齐',
  shared_bridge_tags: '共享主题标签发现',
  explicit_bridge_object: '显式桥接对象发现',
};

export function InterdisciplinaryPage() {
  const {
    selectedSourceKey,
    setSelectedNodeId,
    setWorkspace,
    switchSource,
  } = useAppState();
  const [overview, setOverview] = useState<InterdisciplinaryOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [pairFilter, setPairFilter] = useState<DomainPairFilter>(null);
  const [minimumAlignmentScore, setMinimumAlignmentScore] = useState(0.74);
  const [minimumRelationScore, setMinimumRelationScore] = useState(0.58);
  const [maximumCandidates, setMaximumCandidates] = useState(500);
  const [replacePending, setReplacePending] = useState(true);
  const [reviewer, setReviewer] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<Record<string, string[]>>({});
  const [relationTypes, setRelationTypes] = useState<Record<string, ActiveEdgeType>>({});
  const [directions, setDirections] = useState<Record<string, RelationDirection>>({});
  const [bridgePathReviews, setBridgePathReviews] = useState<Record<string, BridgePathReview>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!selectedSourceKey) return;
    setLoading(true);
    setError('');
    try {
      const payload = await loadInterdisciplinaryOverview(selectedSourceKey);
      setOverview(payload);
      setRelationTypes((current) => seedRelationTypes(current, payload.candidates));
      setDirections((current) => seedDirections(current, payload.candidates));
      setSelectedEvidence((current) => pruneSelectedEvidence(current, payload.candidates));
      setBridgePathReviews((current) => seedBridgePathReviews(current, payload.candidates));
    } catch (loadError) {
      setError(errorMessage(loadError));
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [selectedSourceKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredCandidates = useMemo(() => {
    return (overview?.candidates ?? []).filter((candidate) => {
      if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
      if (kindFilter !== 'all' && candidate.candidate_kind !== kindFilter) return false;
      if (pairFilter && !candidateMatchesDomainPair(candidate, pairFilter.source, pairFilter.target)) return false;
      return true;
    });
  }, [kindFilter, overview, pairFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0, applied: 0, all: 0 };
    for (const candidate of overview?.candidates ?? []) {
      counts[candidate.status] += 1;
      counts.all += 1;
    }
    return counts;
  }, [overview]);

  const runAnalysis = useCallback(async () => {
    if (!selectedSourceKey) return;
    if (replacePending && (overview?.summary.pending_alignment_count ?? 0) + (overview?.summary.pending_relation_count ?? 0) + (overview?.summary.pending_bridge_path_count ?? 0) > 0) {
      const confirmed = window.confirm('本次扫描会替换现有待审核候选项，已经批准、拒绝或写入的记录不会删除。是否继续？');
      if (!confirmed) return;
    }
    setAction('analyze');
    setError('');
    setNotice('');
    try {
      const result = await analyzeInterdisciplinaryGraph(selectedSourceKey, {
        minimum_alignment_score: minimumAlignmentScore,
        minimum_relation_score: minimumRelationScore,
        maximum_candidates: maximumCandidates,
        replace_pending: replacePending,
      });
      setNotice(`扫描完成：新增 ${result.candidates_created} 个候选，其中同一对象 ${result.alignment_candidates} 个、直接关系 ${result.relation_candidates} 个、桥接路径 ${result.bridge_path_candidates} 个。`);
      setStatusFilter('pending');
      await refresh();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setAction(null);
    }
  }, [maximumCandidates, minimumAlignmentScore, minimumRelationScore, overview, refresh, replacePending, selectedSourceKey]);

  const reviewCandidate = useCallback(async (
    candidate: InterdisciplinaryCandidate,
    decision: 'approve' | 'reject',
  ) => {
    if (!selectedSourceKey) return;
    const availableEvidenceIds = new Set(candidate.evidence.map((evidence) => evidence.evidence_id));
    const evidenceIds = (selectedEvidence[candidate.candidate_id] ?? []).filter((id) => availableEvidenceIds.has(id));
    const bridgeReview = bridgePathReviews[candidate.candidate_id];
    const readiness = reviewReadiness(candidate, evidenceIds, bridgeReview?.evidenceIds ?? []);
    if (decision === 'approve' && !readiness.ready) {
      setError(readiness.message);
      return;
    }
    if (candidate.candidate_kind === 'node_alignment' && decision === 'approve') {
      const confirmed = window.confirm(`批准后，正式应用阶段会把“${candidate.from_node_name}”与“${candidate.to_node_name}”归并为同一知识节点。请确认它们确实是同一对象。`);
      if (!confirmed) return;
    }
    setAction(`review:${candidate.candidate_id}`);
    setError('');
    setNotice('');
    const request: InterdisciplinaryReviewRequest = {
      decision,
      reviewer: reviewer.trim() || undefined,
      notes: notes[candidate.candidate_id]?.trim() || undefined,
    };
    if (candidate.candidate_kind === 'relation' && decision === 'approve') {
      request.relation_type = relationTypes[candidate.candidate_id] ?? candidate.proposed_edge_type ?? 'related_to';
      const direction = directions[candidate.candidate_id] ?? 'undirected';
      request.directionality = direction === 'undirected' ? 'undirected' : 'directed';
      request.reverse_direction = direction === 'reverse';
      request.evidence_ids = evidenceIds;
    }
    if (candidate.candidate_kind === 'bridge_path' && decision === 'approve') {
      request.path = candidate.proposed_path.map((segment, index) => ({
        from_node_id: segment.from_node_id,
        to_node_id: segment.to_node_id,
        relation_type: bridgeReview?.relationTypes[index] ?? activeRelationType(segment.relation_type),
        directionality: bridgeReview?.directions[index] ?? segment.directionality,
        evidence_ids: (bridgeReview?.evidenceIds[index] ?? []).filter((id) => availableEvidenceIds.has(id)),
      }));
    }
    try {
      await reviewInterdisciplinaryCandidate(selectedSourceKey, candidate.candidate_id, request);
      setNotice(decision === 'approve' ? '候选项已批准，等待正式应用。' : '候选项已拒绝。');
      await refresh();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setAction(null);
    }
  }, [bridgePathReviews, directions, notes, refresh, relationTypes, reviewer, selectedEvidence, selectedSourceKey]);

  const applyApproved = useCallback(async () => {
    if (!selectedSourceKey || !overview?.summary.approved_candidate_count) return;
    const confirmed = window.confirm('正式应用会归并已批准的同一对象候选，并把有证据的已批准关系写入正式图谱。是否继续？');
    if (!confirmed) return;
    setAction('apply');
    setError('');
    setNotice('');
    try {
      const result = await applyInterdisciplinaryCandidates(selectedSourceKey);
      setNotice(`正式应用完成：归并 ${result.alignments_applied} 项，应用桥接路径 ${result.bridge_paths_applied} 条，写入关系 ${result.relations_applied} 条，跳过 ${result.skipped} 项。`);
      await Promise.all([refresh(), switchSource(selectedSourceKey)]);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setAction(null);
    }
  }, [overview?.summary.approved_candidate_count, refresh, selectedSourceKey, switchSource]);

  const openNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setWorkspace('graph');
  }, [setSelectedNodeId, setWorkspace]);

  if (!selectedSourceKey) {
    return <EmptyState title="等待数据源" detail="选择一个数据源后才能扫描跨学科连接。" />;
  }

  const summary = overview?.summary;
  const pendingCount = (summary?.pending_alignment_count ?? 0) + (summary?.pending_relation_count ?? 0) + (summary?.pending_bridge_path_count ?? 0);
  const maxDomainNodes = Math.max(1, ...(overview?.domains ?? []).map((domain) => domain.node_count));

  return (
    <main className="min-h-0 flex-1 overflow-auto bg-void" aria-busy={loading}>
      <div className="mx-auto w-full max-w-[1800px] space-y-4 p-4">
        <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-panel">
          <div className="flex flex-col gap-4 border-b border-border-subtle bg-elevated/45 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-base font-semibold text-text-primary">跨学科知识网络</h1>
                  <p className="mt-0.5 text-xs text-text-muted">发现同一对象、直接关系和经由抽象对象连接的桥接路径，核验后再写入正式网络</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <NumberField label="同一对象阈值" value={minimumAlignmentScore} min={0} max={1} step={0.01} onChange={setMinimumAlignmentScore} />
              <NumberField label="关系候选阈值" value={minimumRelationScore} min={0} max={1} step={0.01} onChange={setMinimumRelationScore} />
              <NumberField label="候选上限" value={maximumCandidates} min={1} max={5000} step={50} onChange={(value) => setMaximumCandidates(Math.round(value))} />
              <label className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={replacePending}
                  onChange={(event) => setReplacePending(event.target.checked)}
                  className="accent-accent"
                />
                替换待审核项
              </label>
              <button
                type="button"
                onClick={() => void runAnalysis()}
                disabled={Boolean(action)}
                className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-glow-soft transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
              >
                {action === 'analyze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                扫描候选
              </button>
              <button
                type="button"
                onClick={() => void applyApproved()}
                disabled={Boolean(action) || !summary?.approved_candidate_count}
                className="flex h-9 items-center gap-2 rounded-lg border border-node-process/40 bg-node-process/10 px-3 text-xs font-semibold text-node-process transition-colors hover:bg-node-process/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {action === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                应用已批准项{summary?.approved_candidate_count ? ` (${summary.approved_candidate_count})` : ''}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-border-subtle lg:grid-cols-7">
            <Metric label="学科领域" value={summary?.domain_count ?? '—'} detail="正式节点覆盖" icon={<BookOpen className="h-4 w-4" />} />
            <Metric label="桥接对象" value={summary?.bridge_node_count ?? '—'} detail="抽象规律、方法或类比" icon={<Network className="h-4 w-4" />} />
            <Metric label="跨学科关系" value={summary?.cross_domain_edge_count ?? '—'} detail="正式图谱中的关系" icon={<GitBranch className="h-4 w-4" />} />
            <Metric label="同一对象待审" value={summary?.pending_alignment_count ?? '—'} detail="批准后执行节点归并" tone="warn" />
            <Metric label="关系待审" value={summary?.pending_relation_count ?? '—'} detail="必须核验直接证据" tone="warn" />
            <Metric label="桥接路径待审" value={summary?.pending_bridge_path_count ?? '—'} detail="逐段核验关系和证据" tone="warn" />
            <Metric label="已批准待应用" value={summary?.approved_candidate_count ?? '—'} detail="尚未改动正式图谱" tone="ok" />
            <div aria-hidden="true" className="min-h-24 bg-surface lg:hidden" />
          </div>
        </section>

        {(error || notice) && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${error ? 'border-node-event/40 bg-node-event/10 text-node-event' : 'border-node-process/40 bg-node-process/10 text-node-process'}`}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {error ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{error || notice}</span>
          </div>
        )}

        <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-surface">
            <div className="flex flex-col gap-3 border-b border-border-subtle p-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">候选审核队列</div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                  {pairFilter ? `${domainLabel(pairFilter.source)} × ${domainLabel(pairFilter.target)} · ` : ''}
                  当前显示 {filteredCandidates.length} 项，共 {overview?.candidates.length ?? 0} 项
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary">
                  <Filter className="h-3 w-3 text-text-muted" />
                  <select
                    value={kindFilter}
                    onChange={(event) => setKindFilter(event.target.value as KindFilter)}
                    aria-label="按候选类型筛选"
                    className="bg-transparent text-text-primary outline-none"
                  >
                    <option value="all">全部类型</option>
                    <option value="node_alignment">同一知识对象</option>
                    <option value="relation">跨学科关系</option>
                    <option value="bridge_path">桥接路径</option>
                  </select>
                </label>
                {pairFilter && (
                  <button type="button" onClick={() => setPairFilter(null)} className="flex h-8 items-center gap-1 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary hover:bg-hover">
                    <X className="h-3 w-3" /> 清除学科对
                  </button>
                )}
                <label className="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary">
                  审核人
                  <input
                    value={reviewer}
                    onChange={(event) => setReviewer(event.target.value)}
                    placeholder="可选"
                    aria-label="审核人"
                    className="w-24 bg-transparent text-text-primary placeholder:text-text-muted outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  aria-pressed={statusFilter === filter.id}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${statusFilter === filter.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
                >
                  {filter.label} <span className="ml-1 tabular-nums opacity-75">{statusCounts[filter.id]}</span>
                </button>
              ))}
            </div>

            <div className="max-h-[calc(100vh-350px)] min-h-[520px] space-y-3 overflow-y-auto p-3 scrollbar-thin">
              {loading && !overview ? (
                <div className="flex h-64 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />正在读取跨学科数据</div>
              ) : filteredCandidates.length === 0 ? (
                <EmptyQueue pendingCount={pendingCount} />
              ) : (
                filteredCandidates.slice(0, 100).map((candidate) => (
                  <CandidateCard
                    key={candidate.candidate_id}
                    candidate={candidate}
                    selectedEvidenceIds={candidate.status === 'pending'
                      ? selectedEvidence[candidate.candidate_id] ?? []
                      : candidate.evidence_refs}
                    relationType={relationTypes[candidate.candidate_id] ?? activeRelationType(candidate.proposed_edge_type)}
                    direction={directions[candidate.candidate_id] ?? 'undirected'}
                    bridgePathReview={bridgePathReviews[candidate.candidate_id] ?? makeBridgePathReview(candidate)}
                    notes={notes[candidate.candidate_id] ?? ''}
                    busy={action === `review:${candidate.candidate_id}`}
                    disabled={Boolean(action)}
                    onEvidenceChange={(ids) => setSelectedEvidence((current) => ({ ...current, [candidate.candidate_id]: ids }))}
                    onRelationTypeChange={(value) => setRelationTypes((current) => ({ ...current, [candidate.candidate_id]: value }))}
                    onDirectionChange={(value) => setDirections((current) => ({ ...current, [candidate.candidate_id]: value }))}
                    onPathRelationTypeChange={(index, value) => setBridgePathReviews((current) => updateBridgePathReview(current, candidate, (review) => {
                      const relationTypes = [...review.relationTypes];
                      relationTypes[index] = value;
                      return { ...review, relationTypes };
                    }))}
                    onPathDirectionChange={(index, value) => setBridgePathReviews((current) => updateBridgePathReview(current, candidate, (review) => {
                      const pathDirections = [...review.directions];
                      pathDirections[index] = value;
                      return { ...review, directions: pathDirections };
                    }))}
                    onPathEvidenceChange={(index, ids) => setBridgePathReviews((current) => updateBridgePathReview(current, candidate, (review) => {
                      const pathEvidenceIds = review.evidenceIds.map((items) => [...items]);
                      pathEvidenceIds[index] = ids;
                      return { ...review, evidenceIds: pathEvidenceIds };
                    }))}
                    onNotesChange={(value) => setNotes((current) => ({ ...current, [candidate.candidate_id]: value }))}
                    onApprove={() => void reviewCandidate(candidate, 'approve')}
                    onReject={() => void reviewCandidate(candidate, 'reject')}
                    onOpenNode={openNode}
                  />
                ))
              )}
              {filteredCandidates.length > 100 && (
                <div className="rounded-lg border border-border-subtle bg-elevated p-3 text-center text-[11px] text-text-muted">为保证页面流畅，当前只显示前 100 项。请使用状态、类型或学科对筛选。</div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
              <div className="border-b border-border-subtle p-3">
                <div className="text-xs font-semibold text-text-primary">学科覆盖</div>
                <div className="mt-0.5 text-[11px] text-text-muted">节点数与桥接节点数</div>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto p-3 scrollbar-thin">
                {(overview?.domains ?? []).map((domain) => (
                  <div key={domain.domain}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-text-secondary">{domainLabel(domain.domain)}</span>
                      <span className="tabular-nums text-text-muted">{domain.node_count} 节点 · {domain.bridge_node_count} 桥接</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, domain.node_count / maxDomainNodes * 100)}%` }} />
                    </div>
                  </div>
                ))}
                {!overview?.domains.length && <SidebarEmpty>尚无带学科归属的正式节点</SidebarEmpty>}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
              <div className="border-b border-border-subtle p-3">
                <div className="text-xs font-semibold text-text-primary">学科连接对</div>
                <div className="mt-0.5 text-[11px] text-text-muted">点击可筛选对应候选项</div>
              </div>
              <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto scrollbar-thin">
                {(overview?.domain_pairs ?? []).slice(0, 30).map((pair) => {
                  const active = pairFilter?.source === pair.source_domain && pairFilter.target === pair.target_domain;
                  return (
                    <button
                      key={`${pair.source_domain}:${pair.target_domain}`}
                      type="button"
                      onClick={() => setPairFilter({ source: pair.source_domain, target: pair.target_domain })}
                      aria-pressed={active}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${active ? 'bg-accent/10' : 'hover:bg-hover'}`}
                    >
                      <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary">{domainLabel(pair.source_domain)} × {domainLabel(pair.target_domain)}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-text-muted">
                        <span title="共享节点">共 {pair.shared_node_count}</span>
                        <span title="正式跨学科关系">边 {pair.cross_domain_edge_count}</span>
                        {pair.pending_candidate_count > 0 && <span className="rounded bg-node-method/15 px-1.5 py-0.5 text-node-method">待审 {pair.pending_candidate_count}</span>}
                      </span>
                    </button>
                  );
                })}
                {!overview?.domain_pairs.length && <SidebarEmpty>尚未形成学科连接对</SidebarEmpty>}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border-subtle bg-surface">
              <div className="border-b border-border-subtle p-3">
                <div className="text-xs font-semibold text-text-primary">桥接节点</div>
                <div className="mt-0.5 text-[11px] text-text-muted">显式标记或具有跨学科、通用语义的正式知识对象</div>
              </div>
              <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto scrollbar-thin">
                {(overview?.bridge_nodes ?? []).slice(0, 30).map((node) => (
                  <button key={node.node_id} type="button" onClick={() => openNode(node.node_id)} className="w-full px-3 py-2.5 text-left transition-colors hover:bg-hover">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-text-primary">{node.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-muted">度 {node.degree}</span>
                    </div>
                    <div className="mt-1 truncate text-[10px] text-text-muted">{node.domains.map(domainLabel).join(' · ')} · {node.evidence_count} 条证据</div>
                  </button>
                ))}
                {!overview?.bridge_nodes.length && <SidebarEmpty>尚无桥接节点</SidebarEmpty>}
              </div>
            </section>

            <div className="rounded-xl border border-border-subtle bg-elevated/70 p-3 text-[11px] leading-5 text-text-muted">
              最近扫描：{overview?.latest_run ? formatTime(overview.latest_run.completed_at ?? overview.latest_run.created_at) : '尚未执行'}。候选只用于审核，不会自动成为正式关系；拒绝和已写入记录会保留，后续扫描不会反复生成同一候选。
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function CandidateCard({
  candidate,
  selectedEvidenceIds,
  relationType,
  direction,
  bridgePathReview,
  notes,
  busy,
  disabled,
  onEvidenceChange,
  onRelationTypeChange,
  onDirectionChange,
  onPathRelationTypeChange,
  onPathDirectionChange,
  onPathEvidenceChange,
  onNotesChange,
  onApprove,
  onReject,
  onOpenNode,
}: {
  candidate: InterdisciplinaryCandidate;
  selectedEvidenceIds: string[];
  relationType: ActiveEdgeType;
  direction: RelationDirection;
  bridgePathReview: BridgePathReview;
  notes: string;
  busy: boolean;
  disabled: boolean;
  onEvidenceChange: (ids: string[]) => void;
  onRelationTypeChange: (value: ActiveEdgeType) => void;
  onDirectionChange: (value: RelationDirection) => void;
  onPathRelationTypeChange: (index: number, value: ActiveEdgeType) => void;
  onPathDirectionChange: (index: number, value: 'directed' | 'undirected') => void;
  onPathEvidenceChange: (index: number, ids: string[]) => void;
  onNotesChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const readiness = reviewReadiness(candidate, selectedEvidenceIds, bridgePathReview.evidenceIds);
  const method = String(candidate.rationale.method ?? '');
  const sharedTags = Array.isArray(candidate.rationale.shared_bridge_tags)
    ? candidate.rationale.shared_bridge_tags.map(String).filter(Boolean)
    : [];
  const pending = candidate.status === 'pending';

  const toggleEvidence = (evidenceId: string, checked: boolean) => {
    onEvidenceChange(checked
      ? [...new Set([...selectedEvidenceIds, evidenceId])]
      : selectedEvidenceIds.filter((id) => id !== evidenceId));
  };

  return (
    <article className="overflow-hidden rounded-lg border border-border-subtle bg-elevated/55">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${candidate.candidate_kind === 'node_alignment' ? 'bg-accent/15 text-accent' : 'bg-node-rule/15 text-node-rule'}`}>{candidateKindLabel(candidate.candidate_kind)}</span>
          <StatusBadge status={candidate.status} />
          <span className="text-[10px] text-text-muted">{METHOD_LABELS[method] ?? (method || '规则发现')}</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-text-secondary">可信度 {Math.round(candidate.confidence * 100)}%</span>
      </div>

      <div className={`grid gap-2 p-3 md:items-center ${candidate.candidate_kind === 'bridge_path' ? 'md:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)]' : 'md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)]'}`}>
        <NodeButton
          id={candidate.from_node_id}
          name={candidate.from_node_name}
          kind={candidate.from_node_kind}
          definition={candidate.from_node_definition}
          domains={candidate.source_domains}
          onClick={onOpenNode}
        />
        <div className="flex h-8 items-center justify-center text-text-muted"><GitBranch className="h-4 w-4 rotate-90 md:rotate-0" /></div>
        {candidate.candidate_kind === 'bridge_path' && candidate.bridge_node_id && (
          <>
            <NodeButton
              id={candidate.bridge_node_id}
              name={candidate.bridge_node_name ?? candidate.bridge_node_id}
              kind={candidate.bridge_node_kind ?? 'concept'}
              definition={candidate.bridge_node_definition ?? ''}
              domains={candidate.bridge_node_domains}
              badge="桥接对象"
              onClick={onOpenNode}
            />
            <div className="flex h-8 items-center justify-center text-text-muted"><GitBranch className="h-4 w-4 rotate-90 md:rotate-0" /></div>
          </>
        )}
        <NodeButton
          id={candidate.to_node_id}
          name={candidate.to_node_name}
          kind={candidate.to_node_kind}
          definition={candidate.to_node_definition}
          domains={candidate.target_domains}
          onClick={onOpenNode}
        />
      </div>

      {candidate.candidate_kind === 'node_alignment' ? (
        <div className="mx-3 mb-3 space-y-2">
          <div className="rounded-md border border-accent/25 bg-accent/5 px-2.5 py-2 text-[11px] leading-5 text-text-secondary">
            这不是“相似关系”。批准表示两端是同一个知识对象，正式应用时会保留一个正式节点并迁移相关关系、证据和画像。
          </div>
          <div className="rounded-md border border-border-subtle bg-surface p-2.5">
            <div className="mb-1.5 text-[10px] font-semibold text-text-secondary">对象核对材料</div>
            <div className="max-h-36 space-y-1.5 overflow-y-auto scrollbar-thin">
              {candidate.evidence.slice(0, 6).map((evidence) => (
                <div key={evidence.evidence_id} className="rounded border border-border-subtle bg-elevated/60 p-2">
                  <div className="line-clamp-2 text-[10px] leading-4 text-text-secondary">{evidence.excerpt || '无摘录文本'}</div>
                  <div className="mt-1 truncate text-[9px] text-text-muted">{evidence.source_id} · {evidence.anchor_ref}{pageLabel(evidence.page_start, evidence.page_end)}</div>
                </div>
              ))}
              {candidate.evidence.length === 0 && <div className="text-[10px] leading-4 text-node-event">没有可核对的来源证据，请结合节点定义谨慎判断；证据不足时应拒绝。</div>}
              {candidate.evidence.length > 6 && <div className="text-[9px] text-text-muted">其余 {candidate.evidence.length - 6} 条材料可在节点详情中查看。</div>}
            </div>
          </div>
        </div>
      ) : candidate.candidate_kind === 'bridge_path' ? (
        <BridgePathEditor
          candidate={candidate}
          review={bridgePathReview}
          pending={pending}
          onRelationTypeChange={onPathRelationTypeChange}
          onDirectionChange={onPathDirectionChange}
          onEvidenceChange={onPathEvidenceChange}
        />
      ) : (
        <div className="space-y-3 border-t border-border-subtle px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] text-text-muted">
              关系类型
              <select
                value={relationType}
                onChange={(event) => onRelationTypeChange(event.target.value as ActiveEdgeType)}
                disabled={!pending}
                className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-surface px-2 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-60"
              >
                {REVIEWABLE_RELATION_TYPES.map((type) => <option key={type} value={type}>{relationTypeLabel(type)}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-text-muted">
              方向
              <select
                value={direction}
                onChange={(event) => onDirectionChange(event.target.value as RelationDirection)}
                disabled={!pending}
                className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-surface px-2 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-60"
              >
                <option value="undirected">无向</option>
                <option value="forward">左侧 → 右侧</option>
                <option value="reverse">右侧 → 左侧</option>
              </select>
            </label>
          </div>
          {sharedTags.length > 0 && <div className="text-[10px] text-text-muted">共同主题：{sharedTags.join('、')}</div>}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-text-secondary">来源证据核验</span>
              <span className="text-[10px] text-text-muted">已选 {selectedEvidenceIds.length} / {candidate.evidence.length}</span>
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto scrollbar-thin">
              {candidate.evidence.map((evidence) => (
                <label key={evidence.evidence_id} className={`block cursor-pointer rounded-md border p-2 transition-colors ${selectedEvidenceIds.includes(evidence.evidence_id) ? 'border-accent/40 bg-accent/10' : 'border-border-subtle bg-surface hover:bg-hover'}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedEvidenceIds.includes(evidence.evidence_id)}
                      onChange={(event) => toggleEvidence(evidence.evidence_id, event.target.checked)}
                      disabled={!pending}
                      className="mt-0.5 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="line-clamp-3 block text-[11px] leading-5 text-text-secondary">{evidence.excerpt || '无摘录文本'}</span>
                      <span className="mt-1 block truncate text-[10px] text-text-muted">{evidence.source_type_label_zh} · {evidence.source_id} · {evidence.anchor_ref}{pageLabel(evidence.page_start, evidence.page_end)}</span>
                    </span>
                  </div>
                </label>
              ))}
              {candidate.evidence.length === 0 && <div className="rounded-md border border-node-event/30 bg-node-event/5 p-2 text-[10px] text-node-event">没有符合来源策略的可核验证据，只能拒绝或等待补充证据后重新扫描。</div>}
            </div>
          </div>
        </div>
      )}

      {pending ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle p-3 sm:flex-row sm:items-center">
          <label className="min-w-0 flex-1">
            <span className="sr-only">审核备注</span>
            <input
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="审核备注（可选）"
              className="h-8 w-full rounded-md border border-border-subtle bg-surface px-2 text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
            />
          </label>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onReject} disabled={disabled} className="flex h-8 items-center gap-1.5 rounded-md border border-node-event/35 bg-node-event/5 px-2.5 text-[11px] font-medium text-node-event hover:bg-node-event/10 disabled:opacity-50">
              <X className="h-3 w-3" />拒绝
            </button>
            <button type="button" onClick={onApprove} disabled={disabled || !readiness.ready} title={readiness.message} className="flex h-8 items-center gap-1.5 rounded-md border border-node-process/40 bg-node-process/10 px-2.5 text-[11px] font-medium text-node-process hover:bg-node-process/20 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}批准
            </button>
          </div>
          <span className="text-[10px] leading-4 text-text-muted sm:max-w-52">{readiness.message}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2 text-[10px] text-text-muted">
          <span>{candidate.reviewer ? `审核人：${candidate.reviewer}` : '未记录审核人'}{candidate.review_notes ? ` · ${candidate.review_notes}` : ''}</span>
          <span>{candidate.applied_edge_ids.length > 0 ? `关系编号：${candidate.applied_edge_ids.join('、')}` : candidate.applied_edge_id ? `关系编号：${candidate.applied_edge_id}` : candidate.reviewed_at ? formatTime(candidate.reviewed_at) : ''}</span>
        </div>
      )}
    </article>
  );
}

function BridgePathEditor({
  candidate,
  review,
  pending,
  onRelationTypeChange,
  onDirectionChange,
  onEvidenceChange,
}: {
  candidate: InterdisciplinaryCandidate;
  review: BridgePathReview;
  pending: boolean;
  onRelationTypeChange: (index: number, value: ActiveEdgeType) => void;
  onDirectionChange: (index: number, value: 'directed' | 'undirected') => void;
  onEvidenceChange: (index: number, ids: string[]) => void;
}) {
  return (
    <div className="space-y-3 border-t border-border-subtle px-3 py-3">
      <div className="rounded-md border border-accent/25 bg-accent/5 px-2.5 py-2 text-[11px] leading-5 text-text-secondary">
        这是一条经由“{candidate.bridge_node_name ?? '桥接对象'}”连接两个学科的两段路径。每一段都要单独选择关系并核验证据。
      </div>
      {candidate.proposed_path.map((segment, index) => {
        const selectedIds = review.evidenceIds[index] ?? [];
        const scopedEvidenceIds = new Set(segment.evidence_refs);
        const evidenceRows = candidate.evidence.filter((evidence) => scopedEvidenceIds.size === 0 || scopedEvidenceIds.has(evidence.evidence_id));
        const toggleEvidence = (evidenceId: string, checked: boolean) => {
          onEvidenceChange(index, checked
            ? [...new Set([...selectedIds, evidenceId])]
            : selectedIds.filter((id) => id !== evidenceId));
        };
        return (
          <fieldset key={`${candidate.candidate_id}:segment:${index}`} className="rounded-md border border-border-subtle bg-surface p-2.5">
            <legend className="px-1 text-[10px] font-semibold text-text-secondary">
              第 {index + 1} 段：{segment.from_node_name} → {segment.to_node_name}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] text-text-muted">
                关系类型
                <select
                  value={review.relationTypes[index] ?? activeRelationType(segment.relation_type)}
                  onChange={(event) => onRelationTypeChange(index, event.target.value as ActiveEdgeType)}
                  disabled={!pending}
                  className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-60"
                >
                  {REVIEWABLE_RELATION_TYPES.map((type) => <option key={type} value={type}>{relationTypeLabel(type)}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-text-muted">
                方向
                <select
                  value={review.directions[index] ?? segment.directionality}
                  onChange={(event) => onDirectionChange(index, event.target.value as 'directed' | 'undirected')}
                  disabled={!pending}
                  className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-primary outline-none focus:border-accent disabled:opacity-60"
                >
                  <option value="directed">有向</option>
                  <option value="undirected">无向</option>
                </select>
              </label>
            </div>
            <div className="mt-2">
              <div className="mb-1.5 text-[10px] font-semibold text-text-secondary">本段证据（已选 {selectedIds.length} 条）</div>
              <div className="max-h-36 space-y-1.5 overflow-y-auto scrollbar-thin">
                {evidenceRows.map((evidence) => (
                  <label key={`${index}:${evidence.evidence_id}`} className={`block cursor-pointer rounded border p-2 ${selectedIds.includes(evidence.evidence_id) ? 'border-accent/40 bg-accent/10' : 'border-border-subtle bg-elevated/60 hover:bg-hover'}`}>
                    <span className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(evidence.evidence_id)}
                        onChange={(event) => toggleEvidence(evidence.evidence_id, event.target.checked)}
                        disabled={!pending}
                        className="mt-0.5 accent-accent"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-[10px] leading-4 text-text-secondary">{evidence.excerpt || '无摘录文本'}</span>
                        <span className="mt-1 block truncate text-[9px] text-text-muted">{evidence.source_type_label_zh} · {evidence.source_id}{pageLabel(evidence.page_start, evidence.page_end)}</span>
                      </span>
                    </span>
                  </label>
                ))}
                {evidenceRows.length === 0 && <div className="text-[10px] text-node-event">本段没有符合来源策略的证据。</div>}
              </div>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function NodeButton({
  id,
  name,
  kind,
  definition,
  domains,
  badge,
  onClick,
}: {
  id: string;
  name: string;
  kind: InterdisciplinaryCandidate['from_node_kind'];
  definition: string;
  domains: string[];
  badge?: string;
  onClick: (id: string) => void;
}) {
  return (
    <button type="button" onClick={() => onClick(id)} className="min-w-0 rounded-md border border-border-subtle bg-surface p-2.5 text-left transition-colors hover:border-accent/40 hover:bg-hover">
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">{name}</span>
        {badge && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent">{badge}</span>}
      </span>
      <span className="mt-1 block truncate text-[10px] text-text-muted">{TYPE_META[kind]?.label ?? kind} · {domains.map(domainLabel).join(' · ') || '未标注学科'}</span>
      <span className="mt-1 line-clamp-2 block text-[10px] leading-4 text-text-secondary">{definition || '暂无定义'}</span>
    </button>
  );
}

function Metric({ label, value, detail, icon, tone = 'neutral' }: { label: string; value: ReactNode; detail: string; icon?: ReactNode; tone?: 'neutral' | 'warn' | 'ok' }) {
  const valueTone = tone === 'warn' ? 'text-node-method' : tone === 'ok' ? 'text-node-process' : 'text-text-primary';
  return (
    <div className="min-h-24 bg-surface p-3">
      <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-text-muted"><span>{label}</span><span className="text-accent">{icon}</span></div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</div>
      <div className="mt-1 text-[10px] text-text-muted">{detail}</div>
    </div>
  );
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="text-[10px] text-text-muted">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 block h-9 w-24 rounded-lg border border-border-subtle bg-surface px-2 text-xs tabular-nums text-text-primary outline-none focus:border-accent"
      />
    </label>
  );
}

function StatusBadge({ status }: { status: InterdisciplinaryCandidateStatus }) {
  const tone = {
    pending: 'bg-node-method/15 text-node-method',
    approved: 'bg-node-process/15 text-node-process',
    rejected: 'bg-node-event/15 text-node-event',
    applied: 'bg-accent/15 text-accent',
  }[status];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{candidateStatusLabel(status)}</span>;
}

function EmptyQueue({ pendingCount }: { pendingCount: number }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-elevated text-text-muted"><BarChart3 className="h-4 w-4" /></div>
      <div className="mt-3 text-xs font-semibold text-text-secondary">当前筛选下没有候选项</div>
      <div className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{pendingCount > 0 ? '可以切换状态、类型或清除学科对筛选。' : '运行“扫描候选”后，这里会显示需要核验的同一对象和跨学科关系。'}</div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-void p-6">
      <div className="text-center"><GitBranch className="mx-auto h-8 w-8 text-text-muted" /><div className="mt-3 text-sm font-semibold text-text-primary">{title}</div><div className="mt-1 text-xs text-text-muted">{detail}</div></div>
    </main>
  );
}

function SidebarEmpty({ children }: { children: ReactNode }) {
  return <div className="p-4 text-center text-[11px] text-text-muted">{children}</div>;
}

function seedRelationTypes(current: Record<string, ActiveEdgeType>, candidates: InterdisciplinaryCandidate[]): Record<string, ActiveEdgeType> {
  const next = { ...current };
  for (const candidate of candidates) {
    if (candidate.candidate_kind === 'relation' && (candidate.status !== 'pending' || !next[candidate.candidate_id])) {
      next[candidate.candidate_id] = activeRelationType(candidate.proposed_edge_type);
    }
  }
  return next;
}

function activeRelationType(value: string | null | undefined): ActiveEdgeType {
  return (ACTIVE_EDGE_TYPES as readonly string[]).includes(value ?? '')
    ? value as ActiveEdgeType
    : 'related_to';
}

function makeBridgePathReview(candidate: InterdisciplinaryCandidate): BridgePathReview {
  return {
    relationTypes: candidate.proposed_path.map((segment) => activeRelationType(segment.relation_type)),
    directions: candidate.proposed_path.map((segment) => segment.directionality),
    evidenceIds: candidate.status === 'pending'
      ? candidate.proposed_path.map(() => [])
      : candidate.proposed_path.map((segment) => [...segment.evidence_refs]),
  };
}

function seedBridgePathReviews(
  current: Record<string, BridgePathReview>,
  candidates: InterdisciplinaryCandidate[],
): Record<string, BridgePathReview> {
  const next: Record<string, BridgePathReview> = {};
  for (const candidate of candidates) {
    if (candidate.candidate_kind !== 'bridge_path') continue;
    const seeded = makeBridgePathReview(candidate);
    const existing = current[candidate.candidate_id];
    if (candidate.status !== 'pending' || !existing) {
      next[candidate.candidate_id] = seeded;
      continue;
    }
    next[candidate.candidate_id] = {
      relationTypes: candidate.proposed_path.map((segment, index) => (
        existing.relationTypes[index] ?? activeRelationType(segment.relation_type)
      )),
      directions: candidate.proposed_path.map((segment, index) => (
        existing.directions[index] ?? segment.directionality
      )),
      evidenceIds: candidate.proposed_path.map((segment, index) => {
        const availableIds = new Set(segment.evidence_refs);
        return (existing.evidenceIds[index] ?? []).filter((id) => availableIds.has(id));
      }),
    };
  }
  return next;
}

function updateBridgePathReview(
  current: Record<string, BridgePathReview>,
  candidate: InterdisciplinaryCandidate,
  update: (review: BridgePathReview) => BridgePathReview,
): Record<string, BridgePathReview> {
  return {
    ...current,
    [candidate.candidate_id]: update(current[candidate.candidate_id] ?? makeBridgePathReview(candidate)),
  };
}

function seedDirections(current: Record<string, RelationDirection>, candidates: InterdisciplinaryCandidate[]): Record<string, RelationDirection> {
  const next = { ...current };
  for (const candidate of candidates) {
    if (candidate.candidate_kind === 'relation' && (candidate.status !== 'pending' || !next[candidate.candidate_id])) {
      next[candidate.candidate_id] = candidate.directionality === 'directed' ? 'forward' : 'undirected';
    }
  }
  return next;
}

function pruneSelectedEvidence(
  current: Record<string, string[]>,
  candidates: InterdisciplinaryCandidate[],
): Record<string, string[]> {
  const availableByCandidate = new Map(candidates.map((candidate) => [
    candidate.candidate_id,
    new Set(candidate.evidence.map((evidence) => evidence.evidence_id)),
  ]));
  const next: Record<string, string[]> = {};
  for (const [candidateId, evidenceIds] of Object.entries(current)) {
    const available = availableByCandidate.get(candidateId);
    if (!available) continue;
    const kept = evidenceIds.filter((id) => available.has(id));
    if (kept.length > 0) next[candidateId] = kept;
  }
  return next;
}

function pageLabel(start: number | null, end: number | null): string {
  if (start == null) return '';
  return end != null && end !== start ? ` · 第 ${start}–${end} 页` : ` · 第 ${start} 页`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '跨学科操作失败。';
}
