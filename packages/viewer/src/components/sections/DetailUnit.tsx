import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { useUnitLoader } from '@/hooks/useUnitLoader';
import { Loader2 } from '@/lib/lucide-icons';
import { resolveEdgeVisual } from '@/lib/edge-styles';
import { SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS } from '@/lib/constants';
import { MarkdownView } from '@/components/MarkdownView';

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function sourceRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function evidenceTitle(ev: Row): string {
  const parts = [text(ev.source_id), ev.page_start != null ? `p.${text(ev.page_start)}` : ''].filter(Boolean);
  return parts.join(' · ');
}

function fragmentTitle(fragment: Row): string {
  const parts = [
    text(fragment.source_id),
    fragment.page_start != null ? `p.${text(fragment.page_start)}` : '',
    text(fragment.anchor_ref),
  ].filter(Boolean);
  return parts.join(' · ');
}

function relationLabel(type: string): string {
  return type.replaceAll('_', ' ');
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

export function DetailUnit({ node }: { node: OKMNode }) {
  const { unit, loading } = useUnitLoader(node);
  const { knowledgeGraph, setSelectedNodeId } = useAppState();

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
      <div>
        <div className="mb-1 text-xs font-medium text-text-muted">知识单元</div>
        <p className="text-sm leading-relaxed text-text-secondary">{node.description}</p>
      </div>
    );
  }

  const outgoing = asRows(unit.relations?.outgoing);
  const incoming = asRows(unit.relations?.incoming);
  const profiles = asRows(unit.domain_profiles);
  const evidence = asRows(unit.evidence);
  const media = asRows(unit.media);
  const sourceFragments = asRows(unit.source_fragments);
  const cardSections = Array.isArray(unit.card?.sections) ? unit.card.sections : [];
  const body = unit.body?.content?.trim() || node.description;
  const related = [...outgoing, ...incoming].slice(0, 12);
  const resolveMarkdownImage = (src: string): string | undefined => {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
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

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 grid grid-cols-4 gap-2 text-center">
          <div className="border border-border-subtle bg-surface-muted px-2 py-2">
            <div className="text-sm font-semibold text-text-primary">{outgoing.length + incoming.length}</div>
            <div className="text-[11px] text-text-muted">关系</div>
          </div>
          <div className="border border-border-subtle bg-surface-muted px-2 py-2">
            <div className="text-sm font-semibold text-text-primary">{evidence.length}</div>
            <div className="text-[11px] text-text-muted">证据</div>
          </div>
          <div className="border border-border-subtle bg-surface-muted px-2 py-2">
            <div className="text-sm font-semibold text-text-primary">{profiles.length}</div>
            <div className="text-[11px] text-text-muted">画像</div>
          </div>
          <div className="border border-border-subtle bg-surface-muted px-2 py-2">
            <div className="text-sm font-semibold text-text-primary">{unit.mentions?.length ?? 0}</div>
            <div className="text-[11px] text-text-muted">提及</div>
          </div>
        </div>
        {body && (
          <>
            <div className="mb-1 text-xs font-medium text-text-muted">节点说明</div>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-l border-border-subtle pl-3 text-sm leading-relaxed text-text-secondary scrollbar-thin">
              <MarkdownView content={body} resolveImageUrl={resolveMarkdownImage} />
            </div>
          </>
        )}
      </section>

      {sourceFragments.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-text-muted">课本原文</div>
            <div className="text-[10px] text-text-muted">{sourceFragments.length} 个分块</div>
          </div>
          <div className="space-y-3">
            {sourceFragments.slice(0, 4).map((fragment, index) => {
              const excerpts = asRows(fragment.excerpts);
              const modalities = sourceRefs(fragment.modalities);
              const markdown = sourceFragmentMarkdown(excerpts);
              return (
                <div key={`${text(fragment.anchor_ref)}:${index}`} className="border border-border-subtle bg-elevated p-2.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                    <span>{fragmentTitle(fragment)}</span>
                    {modalities.map((item) => (
                      <span key={item} className="bg-surface px-1 py-0.5">{item}</span>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-y-auto text-xs leading-relaxed text-text-secondary scrollbar-thin">
                    <MarkdownView content={markdown} resolveImageUrl={resolveMarkdownImage} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {cardSections.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-text-muted">结构化卡片</div>
          <div className="space-y-3">
            {cardSections.map((section, index) => {
              const content = Array.isArray(section.content)
                ? section.content.map(String).filter(Boolean)
                : [text(section.content)].filter(Boolean);
              return (
                <div key={section.id || index}>
                  {section.title && (
                    <div className="mb-1 text-xs font-medium text-text-secondary">{section.title}</div>
                  )}
                  <div className="space-y-3 text-sm leading-relaxed text-text-secondary">
                    {content.map((item, itemIndex) => (
                      <MarkdownView key={itemIndex} content={item} resolveImageUrl={resolveMarkdownImage} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {evidence.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-text-muted">证据明细</div>
          <div className="space-y-2">
            {evidence.slice(0, 12).map((ev) => (
              <div key={text(ev.id)} className="border border-border-subtle bg-elevated p-2.5">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-text-muted">
                  <span>{evidenceTitle(ev)}</span>
                  {text(ev.modality) && <span>{text(ev.modality)}</span>}
                </div>
                <MarkdownView
                  content={text(ev.excerpt || ev.snippet)}
                  className="line-clamp-4 text-xs leading-relaxed text-text-secondary"
                  resolveImageUrl={resolveMarkdownImage}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-text-muted">关系</div>
          <div className="space-y-1">
            {related.map((edge) => {
              const fromId = text(edge.from_id);
              const toId = text(edge.to_id);
              const isOutgoing = fromId === node.id;
              const otherId = isOutgoing ? toId : fromId;
              const otherNode = knowledgeGraph?.nodeById.get(otherId);
              const edgeType = text(edge.type || edge.edge_type);
              const visual = resolveEdgeVisual(edgeType);
              return (
                <button
                  key={text(edge.id)}
                  onClick={() => otherId && setSelectedNodeId(otherId)}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-hover"
                >
                  <div className="h-0.5 w-4 shrink-0" style={{ backgroundColor: visual.stroke }} />
                  <span className="text-text-muted">{isOutgoing ? '→' : '←'}</span>
                  <span className="shrink-0" style={{ color: visual.stroke }}>{relationLabel(edgeType)}</span>
                  <span className="truncate">{otherNode?.name ?? otherId}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {profiles.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-text-muted">领域画像</div>
          <div className="space-y-2">
            {profiles.map((profile) => {
              const stages = sourceRefs(profile.school_stages);
              const roles = sourceRefs(profile.curriculum_roles);
              return (
                <div key={text(profile.id)} className="border border-border-subtle bg-elevated p-2.5">
                  <div className="text-xs font-medium text-text-primary">{text(profile.domain)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {stages.map((stage) => (
                      <span key={stage} className="bg-surface px-1 py-0.5 text-[10px] text-text-muted">
                        {SCHOOL_STAGE_LABELS[stage] ?? stage}
                      </span>
                    ))}
                    {roles.map((role) => (
                      <span key={role} className="bg-surface px-1 py-0.5 text-[10px] text-text-muted">
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
