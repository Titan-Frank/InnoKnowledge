import { useEffect, useState } from 'react';
import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { useUnitLoader } from '@/hooks/useUnitLoader';
import { ChevronDown, ChevronRight, Loader2, Maximize2, X } from '@/lib/lucide-icons';
import { resolveEdgeVisual } from '@/lib/edge-styles';
import {
  CURRICULUM_ROLE_LABELS,
  DOMAIN_LABELS,
  EDGE_TYPE_LABELS,
  PEDAGOGICAL_DIFFICULTY_LABELS,
  PEDAGOGICAL_REVIEW_STATUS_LABELS,
  SCHOOL_STAGE_LABELS,
} from '@/lib/constants';
import { MarkdownView } from '@/components/MarkdownView';

type Row = Record<string, unknown>;
type ExpandedFragment = {
  title: string;
  modalities: string[];
  markdown: string;
};

type EvidenceSummary = {
  badge: string;
  meta: string;
  preview: string;
  title: string;
};

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function sourceRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function asRecord(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item).trim()).filter(Boolean) : [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function hasPedagogicalContent(value: Row): boolean {
  return Boolean(text(value.difficulty_level).trim()) || [
    value.learning_objectives,
    value.diagnostic_questions,
    value.common_errors,
    value.assessment_tasks,
    value.remediation_suggestions,
    value.extension_suggestions,
  ].some((items) => textList(items).length > 0);
}

function pedagogicalContexts(properties: Row, fallbackStages: string[]): Array<{ key: string; stage: string; value: Row }> {
  const byStage = asRecord(properties.pedagogical_profiles_by_stage);
  const stageOrder = ['primary', 'junior-secondary', 'senior-secondary', 'higher'];
  const contexts = Object.entries(byStage)
    .map(([stage, value]) => ({ key: stage, stage, value: asRecord(value) }))
    .filter((item) => hasPedagogicalContent(item.value))
    .sort((left, right) => {
      const leftIndex = stageOrder.indexOf(left.stage);
      const rightIndex = stageOrder.indexOf(right.stage);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
  const legacy = asRecord(properties.pedagogical_profile);
  if (!hasPedagogicalContent(legacy)) return contexts;
  const stage = contexts.length === 0 && fallbackStages.length === 1 ? fallbackStages[0]! : '';
  return [...contexts, { key: 'legacy', stage, value: legacy }];
}

function generatedDateLabel(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('zh-CN');
}

function gradeBandLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return '';
  if (normalized === 'university') return '大学';
  const match = /^grade-?(\d{1,2})$/.exec(normalized);
  if (!match) return value;
  const labels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const grade = Number(match[1]);
  return grade >= 1 && grade <= labels.length ? `${labels[grade - 1]}年级` : value;
}

function evidenceAnchorId(evidenceId: string): string {
  return `evidence-${evidenceId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function evidenceIdsFromRows(rows: Row[]): string[] {
  return uniqueValues(rows.map((row) => text(row.id)).filter(Boolean));
}

function evidenceIdsForFragment(fragment: Row, evidenceRows: Row[]): string[] {
  const ids = evidenceIdsFromRows(asRows(fragment.excerpts));
  const sourceId = text(fragment.source_id);
  const anchorRef = text(fragment.anchor_ref);
  if (!sourceId || !anchorRef) return ids;
  const matchingEvidenceIds = evidenceRows
    .filter((row) => text(row.source_id) === sourceId && text(row.anchor_ref) === anchorRef)
    .map((row) => text(row.id))
    .filter(Boolean);
  return uniqueValues([...ids, ...matchingEvidenceIds]);
}

function fragmentTitle(fragment: Row, index: number): string {
  const prefix = `课本片段 ${index + 1}`;
  if (fragment.page_start != null && fragment.page_end != null && fragment.page_end !== fragment.page_start) {
    return `${prefix} · 第 ${text(fragment.page_start)}-${text(fragment.page_end)} 页`;
  }
  if (fragment.page_start != null) return `${prefix} · 第 ${text(fragment.page_start)} 页`;
  return prefix;
}

function sourceFragmentKey(fragment: Row, index: number): string {
  return `${text(fragment.source_id)}:${text(fragment.anchor_ref)}:${index}`;
}

function modalityLabel(value: string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    equation: '公式',
    table: '表格',
    textbook: '课本',
  };
  return labels[value] || value;
}

function pageRangeLabel(row: Row): string {
  const start = row.page_start ?? row.page;
  const end = row.page_end;
  if (start != null && end != null && end !== start) return `第 ${text(start)}-${text(end)} 页`;
  if (start != null) return `第 ${text(start)} 页`;
  return '';
}

function compactPreview(value: string, maxLength = 52): string {
  const cleaned = value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>[\\\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function evidenceModality(row: Row | undefined): string {
  if (!row) return '';
  const properties = asRecord(row.properties);
  const value = text(row.modality || properties.modality || '').toLowerCase();
  if (value) return value;
  const excerpt = text(row.excerpt);
  if (/!\[[^\]]*]\([^)]+\)/.test(excerpt) || /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(excerpt)) return 'image';
  return text(row.source_type).toLowerCase();
}

function evidenceSummary(evidenceId: string, evidenceNumber: number, row: Row | undefined): EvidenceSummary {
  const modality = evidenceModality(row);
  const page = row ? pageRangeLabel(row) : '';
  const meta = [modality ? modalityLabel(modality) : '证据', page].filter(Boolean).join(' · ');
  const preview = compactPreview(text(row?.excerpt || row?.locator || row?.anchor_ref || evidenceId));
  const fallbackPreview = preview || evidenceId;
  return {
    badge: `#${evidenceNumber}`,
    meta: meta || `证据 ${evidenceNumber}`,
    preview: fallbackPreview,
    title: `${meta || `证据 ${evidenceNumber}`}：${fallbackPreview}\n${evidenceId}`,
  };
}

function evidenceOverview(evidenceIds: string[], evidenceById: Map<string, Row>): string {
  const order = ['text', 'equation', 'image', 'table'];
  const counts = new Map<string, number>();
  for (const evidenceId of evidenceIds) {
    const modality = evidenceModality(evidenceById.get(evidenceId)) || 'evidence';
    counts.set(modality, (counts.get(modality) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return modalityLabel(a).localeCompare(modalityLabel(b), 'zh-CN');
    })
    .map(([modality, count]) => `${modalityLabel(modality)} ${count}`)
    .join(' · ');
}

function relationLabel(type: string): string {
  return EDGE_TYPE_LABELS[type] || '关联';
}

function relationDisplay(edge: Record<string, unknown>, fallbackType: string): { label: string; color?: string } {
  const properties = edge.properties && typeof edge.properties === 'object' && !Array.isArray(edge.properties)
    ? edge.properties as Record<string, unknown>
    : {};
  const templateDisplay = properties.template_display && typeof properties.template_display === 'object' && !Array.isArray(properties.template_display)
    ? properties.template_display as Record<string, unknown>
    : {};
  return {
    label: typeof templateDisplay.label === 'string' && templateDisplay.label.trim() ? templateDisplay.label : relationLabel(fallbackType),
    color: typeof templateDisplay.color === 'string' && templateDisplay.color.trim() ? templateDisplay.color : undefined,
  };
}

function normalizeAssetRef(value: string): string {
  const clean = value.trim().split(/[?#]/, 1)[0] ?? '';
  try {
    return decodeURIComponent(clean).replace(/\\/g, '/').toLowerCase();
  } catch {
    return clean.replace(/\\/g, '/').toLowerCase();
  }
}

function basename(value: string): string {
  const normalized = normalizeAssetRef(value);
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function imageSrcFromMarkdown(value: string): string {
  const match = value.match(/!\[[^\]]*\]\(([^)\n]+)\)/);
  return match ? match[1].trim() : '';
}

function imageSrcFromRow(row: Row): string {
  const properties = row.properties && typeof row.properties === 'object' && !Array.isArray(row.properties)
    ? row.properties as Row
    : {};
  const candidates = [
    properties.path,
    properties.image_path,
    properties.src,
    row.locator,
    row.excerpt,
  ];
  for (const candidate of candidates) {
    const value = text(candidate).trim();
    if (!value) continue;
    const markdownSrc = imageSrcFromMarkdown(value);
    const src = markdownSrc || value;
    if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(src) || src.includes('/images/')) return src;
  }
  return '';
}

function markdownImageRefs(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^)\n]+)\)/g)).map((match) => match[1].trim());
}

function sameImageRef(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aName = basename(a).replace(/…$/, '');
  const bName = basename(b).replace(/…$/, '');
  if (aName === bName) return true;
  return aName.length >= 8 && bName.startsWith(aName);
}

function sourceFragmentMarkdown(excerpts: Row[]): string {
  const lines: string[] = [];
  const seenImages: string[] = [];

  for (const item of excerpts) {
    const excerpt = text(item.excerpt).trim();
    const modality = text(item.modality).toLowerCase();
    if (modality === 'image') {
      const imageSrc = imageSrcFromRow(item);
      if (!imageSrc || seenImages.some((seen) => sameImageRef(seen, imageSrc))) continue;
      seenImages.push(imageSrc);
      lines.push(`![](${imageSrc})`);
      continue;
    }

    if (!excerpt) continue;
    lines.push(excerpt);
    seenImages.push(...markdownImageRefs(excerpt));
  }

  return lines.join('\n\n').trim() || '这个分块主要是图片证据。';
}

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      {meta && <div className="shrink-0 text-xs text-text-secondary">{meta}</div>}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-3 py-2 text-center">
      <div className="text-base font-semibold tabular-nums text-text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-text-secondary">{label}</div>
    </div>
  );
}

function DetailListGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface p-3">
      <div className="mb-2 text-xs font-medium text-text-primary">{title}</div>
      <ul className="space-y-1.5 text-sm leading-relaxed text-text-secondary">
        {items.map((item, index) => (
          <li key={`${title}:${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const detailMarkdownClass = [
  'text-base leading-7 text-text-secondary',
].join(' ');

const evidenceMarkdownClass = [
  'text-[15px] leading-7 text-text-secondary',
].join(' ');

const expandedFragmentMarkdownClass = [
  'text-lg leading-9 text-text-secondary',
].join(' ');

export function DetailUnit({ node }: { node: OKMNode }) {
  const { unit, loading } = useUnitLoader(node);
  const { knowledgeGraph, setSelectedNodeId } = useAppState();
  const [expandedFragment, setExpandedFragment] = useState<ExpandedFragment | null>(null);
  const [expandedEvidenceKeys, setExpandedEvidenceKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedFragment(null);
    setExpandedEvidenceKeys(new Set());
  }, [node.id]);

  useEffect(() => {
    if (!expandedFragment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setExpandedFragment(null);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [expandedFragment]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        加载知识单元…
      </div>
    );
  }

  if (!unit) {
    return (
      <section aria-label="知识单元" className="rounded-lg border border-border-subtle bg-elevated p-4">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">完整知识单元</h3>
        <p className="text-sm leading-relaxed text-text-secondary">
          当前仅有知识对象骨架，尚未聚合知识正文、关系、证据和领域画像。
        </p>
      </section>
    );
  }

  const outgoing = asRows(unit.relations?.outgoing);
  const incoming = asRows(unit.relations?.incoming);
  const profiles = asRows(unit.domain_profiles);
  const evidence = asRows(unit.evidence);
  const media = asRows(unit.media);
  const sourceFragments = asRows(unit.source_fragments);
  const visibleSourceFragments = sourceFragments.slice(0, 4);
  const visibleEvidenceIds = new Set(
    visibleSourceFragments.flatMap((fragment) => evidenceIdsForFragment(fragment, evidence)),
  );
  const visibleEvidenceAnchorOwners = new Map<string, string>();
  visibleSourceFragments.forEach((fragment, index) => {
    const fragmentKey = sourceFragmentKey(fragment, index);
    for (const evidenceId of evidenceIdsForFragment(fragment, evidence)) {
      if (!visibleEvidenceAnchorOwners.has(evidenceId)) visibleEvidenceAnchorOwners.set(evidenceId, fragmentKey);
    }
  });
  const expandedFragmentByEvidenceId = new Map<string, ExpandedFragment>();
  sourceFragments.forEach((fragment, index) => {
    const expanded = {
      title: fragmentTitle(fragment, index),
      modalities: sourceRefs(fragment.modalities),
      markdown: sourceFragmentMarkdown(asRows(fragment.excerpts)),
    };
    for (const evidenceId of evidenceIdsForFragment(fragment, evidence)) {
      if (!expandedFragmentByEvidenceId.has(evidenceId)) expandedFragmentByEvidenceId.set(evidenceId, expanded);
    }
  });
  const cardSections = Array.isArray(unit.card?.sections) ? unit.card.sections : [];
  const body = unit.body?.content?.trim() || '';
  const bodySourceRefs = sourceRefs(unit.body?.source_refs);
  const completenessScore = typeof unit.completeness?.score === 'number' ? unit.completeness.score : null;
  const semanticCore = asRecord(asRecord(unit.node?.properties).semantic_core);
  const semanticCoreGroups = [
    { title: '核心命题', items: textList(semanticCore.core_claims) },
    { title: '公式与表达', items: textList(semanticCore.formal_expressions) },
    { title: '成立条件', items: textList(semanticCore.conditions) },
    { title: '适用边界', items: textList(semanticCore.boundaries) },
    { title: '反例', items: textList(semanticCore.counterexamples) },
    { title: '常见误解', items: textList(semanticCore.misconceptions) },
  ].filter((group) => group.items.length > 0);
  const evidenceIndex = new Map<string, number>();
  for (const evidenceId of bodySourceRefs) {
    if (!evidenceIndex.has(evidenceId)) evidenceIndex.set(evidenceId, evidenceIndex.size + 1);
  }
  for (const item of evidence) {
    const evidenceId = text(item.id);
    if (evidenceId && !evidenceIndex.has(evidenceId)) evidenceIndex.set(evidenceId, evidenceIndex.size + 1);
  }
  const evidenceById = new Map<string, Row>();
  for (const item of evidence) {
    const evidenceId = text(item.id);
    if (evidenceId) evidenceById.set(evidenceId, item);
  }
  const related = [...outgoing, ...incoming].slice(0, 12);
  const resolveMarkdownImage = (src: string): string | undefined => {
    if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith('/api/source/')) return src;
    const normalized = normalizeAssetRef(src);
    const fileName = basename(src);
    const filePrefix = fileName.replace(/…$/, '');
    const match = media.find((item) => {
      const itemPath = normalizeAssetRef(text(item.path));
      const itemName = basename(itemPath);
      return (
        itemPath === normalized ||
        itemPath.endsWith(`/${normalized}`) ||
        itemName === fileName ||
        (filePrefix.length >= 8 && itemName.startsWith(filePrefix))
      );
    });
    return match ? text(match.url) : undefined;
  };
  const renderEvidenceRef = (evidenceId: string, key: string) => {
    const index = evidenceIndex.get(evidenceId);
    if (!index) {
      return (
        <sup key={key} className="ml-0.5 align-super text-[0.65em] font-semibold text-text-muted" title={evidenceId}>
          [?]
        </sup>
      );
    }
    if (!visibleEvidenceIds.has(evidenceId)) {
      const summary = evidenceSummary(evidenceId, index, evidenceById.get(evidenceId));
      const target = expandedFragmentByEvidenceId.get(evidenceId) ?? {
        title: summary.meta,
        modalities: [evidenceModality(evidenceById.get(evidenceId))].filter(Boolean),
        markdown: text(evidenceById.get(evidenceId)?.excerpt),
      };
      return (
        <sup key={key} className="ml-0.5 align-super text-[0.65em] font-semibold">
          <button
            type="button"
            onClick={() => setExpandedFragment(target)}
            className="rounded-sm px-0.5 text-accent transition-colors hover:bg-accent/15 hover:text-accent"
            title={`查看${summary.meta}: ${summary.preview}`}
            aria-label={`查看${summary.meta}`}
          >
            [{index}]
          </button>
        </sup>
      );
    }
    const summary = evidenceSummary(evidenceId, index, evidenceById.get(evidenceId));
    return (
      <sup key={key} className="ml-0.5 align-super text-[0.65em] font-semibold">
        <a
          href={`#${evidenceAnchorId(evidenceId)}`}
          className="rounded-sm px-0.5 text-accent transition-colors hover:bg-accent/15 hover:text-accent"
          title={`查看${summary.meta}: ${summary.preview}`}
          aria-label={`查看${summary.meta}`}
        >
          [{index}]
        </a>
      </sup>
    );
  };

  const toggleEvidenceList = (key: string) => {
    setExpandedEvidenceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section aria-label="完整知识单元" className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold text-text-primary">完整知识单元</h3>
        <span className="text-xs text-text-secondary">聚合视图</span>
      </div>

      <div>
        <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2">
          <StatTile label="关系" value={outgoing.length + incoming.length} />
          <StatTile label="证据" value={evidence.length} />
          <StatTile label="画像" value={profiles.length} />
          <StatTile label="提及" value={unit.mentions?.length ?? 0} />
          {completenessScore != null && <StatTile label="资料完整度" value={completenessScore} />}
        </div>
        {body && (
          <div className="rounded-lg border border-border-subtle bg-elevated p-4">
            <SectionTitle title="知识正文" />
            <div className="max-h-[360px] overflow-y-auto rounded-md border border-border-subtle bg-surface px-3 py-3 scrollbar-thin">
              <MarkdownView
                content={body}
                className={detailMarkdownClass}
                resolveImageUrl={resolveMarkdownImage}
                renderEvidenceRef={renderEvidenceRef}
              />
            </div>
          </div>
        )}
      </div>

      {semanticCoreGroups.length > 0 && (
        <section className="rounded-lg border border-border-subtle bg-elevated p-4">
          <SectionTitle title="知识骨架" meta={`${semanticCoreGroups.length} 组`} />
          <div className="grid gap-3 sm:grid-cols-2">
            {semanticCoreGroups.map((group) => (
              <DetailListGroup key={group.title} title={group.title} items={group.items} />
            ))}
          </div>
        </section>
      )}

      {sourceFragments.length > 0 && (
        <section className="rounded-lg border border-border-subtle bg-elevated p-4">
          <SectionTitle title="课本原文" meta={`${sourceFragments.length} 个分块`} />
          <div className="space-y-3">
            {visibleSourceFragments.map((fragment, index) => {
              const excerpts = asRows(fragment.excerpts);
              const modalities = sourceRefs(fragment.modalities);
              const fragmentEvidenceIds = evidenceIdsForFragment(fragment, evidence);
              const markdown = sourceFragmentMarkdown(excerpts);
              const title = fragmentTitle(fragment, index);
              const fragmentKey = sourceFragmentKey(fragment, index);
              const evidenceExpanded = expandedEvidenceKeys.has(fragmentKey);
              return (
                <div key={fragmentKey} className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
                  <div className="border-b border-border-subtle px-3 py-2 text-xs text-text-muted">
                    {fragmentEvidenceIds.map((evidenceId) => (
                      visibleEvidenceAnchorOwners.get(evidenceId) === fragmentKey
                        ? (
                          <span
                            key={`anchor:${evidenceId}`}
                            id={evidenceAnchorId(evidenceId)}
                            className="block h-0 scroll-mt-24"
                            aria-hidden="true"
                          />
                        )
                        : null
                    ))}
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate font-medium text-text-secondary">{title}</span>
                        {modalities.map((item) => (
                          <span key={item} className="rounded-full bg-elevated px-2 py-0.5">{modalityLabel(item)}</span>
                        ))}
                        {fragmentEvidenceIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleEvidenceList(fragmentKey)}
                            className="flex max-w-full cursor-pointer items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent transition-colors hover:bg-accent/15"
                            aria-expanded={evidenceExpanded}
                            aria-controls={`fragment-evidence-${index}`}
                          >
                            {evidenceExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <span className="shrink-0">{fragmentEvidenceIds.length} 条证据</span>
                            <span className="hidden min-w-0 truncate text-[11px] text-text-secondary sm:inline">
                              {evidenceOverview(fragmentEvidenceIds, evidenceById)}
                            </span>
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedFragment({ title, modalities, markdown })}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-elevated px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                        aria-label={`全屏查看${title}`}
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        全屏
                      </button>
                    </div>
                    {evidenceExpanded && fragmentEvidenceIds.length > 0 && (
                      <div id={`fragment-evidence-${index}`} className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                        {fragmentEvidenceIds.map((evidenceId) => {
                          const evidenceNumber = evidenceIndex.get(evidenceId);
                          if (!evidenceNumber) return null;
                          const summary = evidenceSummary(evidenceId, evidenceNumber, evidenceById.get(evidenceId));
                          return (
                            <button
                              type="button"
                              key={evidenceId}
                              onClick={() => setExpandedFragment({ title, modalities, markdown })}
                              className="scroll-mt-24 cursor-pointer rounded-md border border-accent/20 bg-accent/10 px-2.5 py-1.5 text-left transition-colors hover:border-accent/45 hover:bg-accent/15 focus-visible:border-accent focus-visible:outline-none"
                              title={summary.title}
                              aria-label={`查看${summary.meta}: ${summary.preview}`}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
                                  {summary.badge}
                                </span>
                                <span className="min-w-0 truncate font-medium text-accent">{summary.meta}</span>
                              </span>
                              <span className="mt-1 block truncate text-[11px] leading-4 text-text-secondary">
                                {summary.preview}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto px-3 py-3 scrollbar-thin">
                    <MarkdownView
                      content={markdown}
                      className={evidenceMarkdownClass}
                      resolveImageUrl={resolveMarkdownImage}
                      imageLayout="preview"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {expandedFragment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/85 p-4 backdrop-blur-sm animate-fade-in">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭片段全屏"
            onClick={() => setExpandedFragment(null)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="expanded-fragment-title"
            className="relative flex max-h-[92vh] w-full max-w-5xl animate-slide-up flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-elevated px-5 py-4">
              <div className="min-w-0">
                <div id="expanded-fragment-title" className="truncate text-base font-semibold text-text-primary">
                  {expandedFragment.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {expandedFragment.modalities.map((item) => (
                    <span key={item} className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">
                      {modalityLabel(item)}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpandedFragment(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                aria-label="关闭片段全屏"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-5 scrollbar-thin sm:px-8">
              <article className="mx-auto min-w-0 max-w-[78ch] rounded-lg border border-border-subtle bg-elevated px-4 py-5 sm:px-6">
                <MarkdownView
                  content={expandedFragment.markdown}
                  className={expandedFragmentMarkdownClass}
                  resolveImageUrl={resolveMarkdownImage}
                  imageLayout="reader"
                />
              </article>
            </div>
          </section>
        </div>
      )}

      {cardSections.length > 0 && (
        <section className="rounded-lg border border-border-subtle bg-elevated p-4">
          <SectionTitle title="结构化卡片" />
          <div className="space-y-3">
            {cardSections.map((section, index) => {
              const content = Array.isArray(section.content)
                ? section.content.map(String).filter(Boolean)
                : [text(section.content)].filter(Boolean);
              return (
                <div key={section.id || index} className="rounded-md border border-border-subtle bg-surface p-3">
                  {section.title && (
                    <div className="mb-2 text-xs font-medium text-text-primary">{section.title}</div>
                  )}
                  <div className="space-y-3 text-sm leading-relaxed text-text-secondary">
                    {content.map((item, itemIndex) => (
                      <MarkdownView key={itemIndex} content={item} className={detailMarkdownClass} resolveImageUrl={resolveMarkdownImage} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="rounded-lg border border-border-subtle bg-elevated p-4">
          <SectionTitle title="关系" meta={`${related.length} 条`} />
          <div className="space-y-1.5">
            {related.map((edge) => {
              const fromId = text(edge.from_id);
              const toId = text(edge.to_id);
              const isOutgoing = fromId === node.id;
              const otherId = isOutgoing ? toId : fromId;
              const otherNode = knowledgeGraph?.nodeById.get(otherId);
              const edgeType = text(edge.type || edge.edge_type);
              const visual = resolveEdgeVisual(edgeType);
              const display = relationDisplay(edge, edgeType);
              const edgeColor = display.color || visual.stroke;
              return (
                <button
                  key={text(edge.id)}
                  onClick={() => otherId && setSelectedNodeId(otherId)}
                  className="flex w-full items-center gap-2 rounded-md border border-transparent bg-surface px-2.5 py-2 text-left text-sm text-text-secondary transition-colors hover:border-border-subtle hover:bg-hover"
                >
                  <div className="h-0.5 w-4 shrink-0" style={{ backgroundColor: edgeColor }} />
                  <span className="text-text-muted">{isOutgoing ? '→' : '←'}</span>
                  <span className="shrink-0" style={{ color: edgeColor }}>{display.label}</span>
                  <span className="truncate">{otherNode?.name ?? otherId}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {profiles.length > 0 && (
        <section className="rounded-lg border border-border-subtle bg-elevated p-4">
          <SectionTitle title="领域画像" meta={`${profiles.length} 个`} />
          <div className="space-y-2">
            {profiles.map((profile) => {
              const stages = sourceRefs(profile.school_stages);
              const roles = sourceRefs(profile.curriculum_roles);
              const properties = asRecord(profile.properties);
              const contexts = pedagogicalContexts(properties, stages);
              const domain = text(profile.domain);
              return (
                <div key={text(profile.id)} className="rounded-lg border border-border-subtle bg-surface p-3">
                  <div className="text-xs font-medium text-text-primary">{DOMAIN_LABELS[domain] ?? domain}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {stages.map((stage) => (
                      <span key={stage} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                        {SCHOOL_STAGE_LABELS[stage] ?? stage}
                      </span>
                    ))}
                    {roles.map((role) => (
                      <span key={role} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                        {CURRICULUM_ROLE_LABELS[role] ?? role}
                      </span>
                    ))}
                  </div>
                  {contexts.map((context) => {
                    const generation = asRecord(context.value.generation);
                    const difficulty = text(context.value.difficulty_level).trim();
                    const generatedFrom = text(generation.generated_from).trim();
                    const reviewStatus = text(generation.review_status).trim();
                    const confidence = Number(generation.confidence);
                    const generatedAt = generatedDateLabel(generation.generated_at);
                    const model = text(generation.model).trim();
                    const contextSourceRefs = sourceRefs(generation.source_refs);
                    const contextStage = text(context.value.school_stage).trim() || context.stage;
                    const contextTitle = context.key === 'legacy' && contexts.length > 1
                      ? '旧版教学画像'
                      : contextStage
                        ? `${SCHOOL_STAGE_LABELS[contextStage] ?? contextStage}教学画像`
                        : '学习与教学';
                    const gradeBand = gradeBandLabel(text(context.value.grade_band));
                    const pedagogicalGroups = [
                      { title: '学习目标', items: textList(context.value.learning_objectives) },
                      { title: '诊断问题', items: textList(context.value.diagnostic_questions) },
                      { title: '常见错误', items: textList(context.value.common_errors) },
                      { title: '评价任务', items: textList(context.value.assessment_tasks) },
                      { title: '补救建议', items: textList(context.value.remediation_suggestions) },
                      { title: '拓展建议', items: textList(context.value.extension_suggestions) },
                    ].filter((group) => group.items.length > 0);
                    return (
                      <div key={`${text(profile.id)}:${context.key}`} className="mt-3 border-t border-border-subtle pt-3">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-primary">
                          <span>{contextTitle}</span>
                          {gradeBand && (
                            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-normal text-text-muted">
                              {gradeBand}
                            </span>
                          )}
                          {difficulty && (
                            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-normal text-text-muted">
                              难度：{PEDAGOGICAL_DIFFICULTY_LABELS[difficulty] ?? difficulty}
                            </span>
                          )}
                          {generatedFrom === 'model_generation' && (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-normal text-accent">
                              模型生成
                            </span>
                          )}
                          {generatedFrom === 'manual' && (
                            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-normal text-text-muted">
                              人工维护
                            </span>
                          )}
                          {reviewStatus && (
                            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-normal text-text-muted">
                              {PEDAGOGICAL_REVIEW_STATUS_LABELS[reviewStatus] ?? reviewStatus}
                            </span>
                          )}
                        </div>
                        {(model || generatedAt || Number.isFinite(confidence) || contextSourceRefs.length > 0) && (
                          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
                            {model && <span>模型：{model}</span>}
                            {generatedAt && <span>生成：{generatedAt}</span>}
                            {Number.isFinite(confidence) && <span>可信度：{Math.round(confidence * 100)}%</span>}
                            {contextSourceRefs.length > 0 && (
                              <span>
                                依据 {contextSourceRefs.length} 条证据
                                {contextSourceRefs.map((evidenceId, index) => renderEvidenceRef(evidenceId, `${text(profile.id)}:${context.key}:evidence:${index}`))}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="grid gap-2">
                          {pedagogicalGroups.map((group) => (
                            <DetailListGroup key={`${text(profile.id)}:${context.key}:${group.title}`} title={group.title} items={group.items} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
