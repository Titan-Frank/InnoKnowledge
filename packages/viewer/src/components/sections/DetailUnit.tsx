import { useEffect, useState } from 'react';
import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { useUnitLoader } from '@/hooks/useUnitLoader';
import { Loader2, Maximize2, X } from '@/lib/lucide-icons';
import { resolveEdgeVisual } from '@/lib/edge-styles';
import { SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS } from '@/lib/constants';
import { MarkdownView } from '@/components/MarkdownView';

type Row = Record<string, unknown>;
type ExpandedFragment = {
  title: string;
  modalities: string[];
  markdown: string;
};
type FragmentImage = {
  src: string;
  alt: string;
};

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function sourceRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
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

function modalityLabel(value: string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    equation: '公式',
    table: '表格',
  };
  return labels[value] || value;
}

function relationLabel(type: string): string {
  const labels: Record<string, string> = {
    is_a: '属于',
    instance_of: '实例',
    prerequisite_for: '前置知识',
    depends_on: '依赖',
    part_of: '组成部分',
    contains: '包含',
    related_to: '相关',
    same_as: '等同',
    causes: '导致',
    affects: '影响',
    uses: '使用',
    produces: '生成',
    represents: '表征',
    about: '关于',
    has_property: '具有性质',
  };
  return labels[type] || '关联';
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

function splitFragmentMarkdown(markdown: string): { textMarkdown: string; images: FragmentImage[] } {
  const imageRe = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  const images: FragmentImage[] = [];
  const textLines = markdown.split('\n').map((line) => {
    let match: RegExpExecArray | null;
    let cleaned = line;
    imageRe.lastIndex = 0;
    while ((match = imageRe.exec(line)) !== null) {
      images.push({
        alt: match[1] || '教材图片',
        src: match[2].trim(),
      });
      cleaned = cleaned.replace(match[0], '').trim();
    }
    return cleaned;
  });

  return {
    textMarkdown: textLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    images,
  };
}

function SectionTitle({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {meta && <div className="shrink-0 text-xs text-text-muted">{meta}</div>}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-3 py-2 text-center">
      <div className="text-base font-semibold tabular-nums text-text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-text-muted">{label}</div>
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

  useEffect(() => {
    setExpandedFragment(null);
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
      <div className="rounded-lg border border-border-subtle bg-elevated p-4">
        <SectionTitle title="知识单元" />
        <p className="text-base leading-7 text-text-secondary">{node.description}</p>
      </div>
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
  const cardSections = Array.isArray(unit.card?.sections) ? unit.card.sections : [];
  const body = unit.body?.content?.trim() || '';
  const bodySourceRefs = sourceRefs(unit.body?.source_refs);
  const evidenceIndex = new Map<string, number>();
  for (const evidenceId of bodySourceRefs) {
    if (!evidenceIndex.has(evidenceId)) evidenceIndex.set(evidenceId, evidenceIndex.size + 1);
  }
  for (const item of evidence) {
    const evidenceId = text(item.id);
    if (evidenceId && !evidenceIndex.has(evidenceId)) evidenceIndex.set(evidenceId, evidenceIndex.size + 1);
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
      return (
        <sup key={key} className="ml-0.5 align-super text-[0.65em] font-semibold text-accent" title={evidenceId}>
          [{index}]
        </sup>
      );
    }
    return (
      <sup key={key} className="ml-0.5 align-super text-[0.65em] font-semibold">
        <a
          href={`#${evidenceAnchorId(evidenceId)}`}
          className="rounded-sm px-0.5 text-accent transition-colors hover:bg-accent/15 hover:text-accent"
          title={`查看证据 ${index}: ${evidenceId}`}
          aria-label={`查看证据 ${index}`}
        >
          [{index}]
        </a>
      </sup>
    );
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-3 grid grid-cols-4 gap-2">
          <StatTile label="关系" value={outgoing.length + incoming.length} />
          <StatTile label="证据" value={evidence.length} />
          <StatTile label="画像" value={profiles.length} />
          <StatTile label="提及" value={unit.mentions?.length ?? 0} />
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
      </section>

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
              return (
                <div key={`${text(fragment.anchor_ref)}:${index}`} className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
                  <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs text-text-muted">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-medium text-text-secondary">{title}</span>
                      {modalities.map((item) => (
                        <span key={item} className="rounded-full bg-elevated px-2 py-0.5">{modalityLabel(item)}</span>
                      ))}
                      {fragmentEvidenceIds.map((evidenceId) => {
                        const evidenceNumber = evidenceIndex.get(evidenceId);
                        if (!evidenceNumber) return null;
                        return (
                          <span
                            key={evidenceId}
                            id={evidenceAnchorId(evidenceId)}
                            className="scroll-mt-24 rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent"
                            title={evidenceId}
                          >
                            证据 {evidenceNumber}
                          </span>
                        );
                      })}
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
        (() => {
          const { textMarkdown, images } = splitFragmentMarkdown(expandedFragment.markdown);
          const resolvedImages = images
            .map((image) => ({ ...image, resolved: resolveMarkdownImage(image.src) }))
            .filter((image) => Boolean(image.resolved));
          const hasText = textMarkdown.length > 0;
          const hasImages = resolvedImages.length > 0;
          return (
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
                className="relative flex max-h-[92vh] w-full max-w-6xl animate-slide-up flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl"
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
                <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-5 py-5 scrollbar-thin sm:px-8">
                  <div className={hasImages && hasText ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,42%)]' : 'space-y-5'}>
                    {hasText && (
                      <article className="min-w-0 rounded-lg border border-border-subtle bg-elevated px-4 py-4 sm:px-5">
                        <MarkdownView
                          content={textMarkdown}
                          className={expandedFragmentMarkdownClass}
                          resolveImageUrl={resolveMarkdownImage}
                          imageLayout="reader"
                        />
                      </article>
                    )}
                    {hasImages && (
                      <div className={hasText ? 'min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start' : 'min-w-0 space-y-3'}>
                        {resolvedImages.map((image, index) => (
                          <figure key={`${image.src}:${index}`} className="overflow-hidden rounded-lg border border-border-subtle bg-elevated p-3">
                            <div className="flex min-h-64 items-center justify-center rounded-md bg-surface">
                              <img
                                src={image.resolved}
                                alt={image.alt}
                                className="max-h-[68vh] w-full max-w-full rounded-md object-contain"
                                loading="lazy"
                              />
                            </div>
                            {image.alt === '教材图片' ? null : (
                              <figcaption className="mt-2 text-xs text-text-muted">{image.alt}</figcaption>
                            )}
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          );
        })()
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
              return (
                <div key={text(profile.id)} className="rounded-lg border border-border-subtle bg-surface p-3">
                  <div className="text-xs font-medium text-text-primary">{text(profile.domain)}</div>
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
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
