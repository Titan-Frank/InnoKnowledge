import type { OKMNode } from '@/core/graph/types';
import { useAppState } from '@/hooks/useAppState';
import { useUnitLoader } from '@/hooks/useUnitLoader';
import { Loader2 } from '@/lib/lucide-icons';
import { resolveEdgeVisual } from '@/lib/edge-styles';
import { SCHOOL_STAGE_LABELS, CURRICULUM_ROLE_LABELS } from '@/lib/constants';

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

function bodyPreview(markdown: string): string {
  return markdown
    .replace(/^#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function evidenceTitle(ev: Row): string {
  const parts = [text(ev.source_id), ev.page_start != null ? `p.${text(ev.page_start)}` : ''].filter(Boolean);
  return parts.join(' · ');
}

function relationLabel(type: string): string {
  return type.replaceAll('_', ' ');
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
  const cardSections = Array.isArray(unit.card?.sections) ? unit.card.sections : [];
  const body = unit.body?.content ? bodyPreview(unit.body.content) : node.description;
  const related = [...outgoing, ...incoming].slice(0, 12);

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
            <div className="mb-1 text-xs font-medium text-text-muted">正文</div>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-l border-border-subtle pl-3 text-sm leading-relaxed text-text-secondary scrollbar-thin">
              {body}
            </div>
          </>
        )}
      </section>

      {media.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-text-muted">图片</div>
            <div className="text-[10px] text-text-muted">{media.length}</div>
          </div>
          <div className="space-y-3">
            {media.slice(0, 8).map((item) => (
              <figure key={text(item.id)} className="overflow-hidden border border-border-subtle bg-elevated">
                <img
                  src={text(item.url)}
                  alt={text(item.caption) || '教材图片'}
                  className="max-h-64 w-full bg-surface object-contain"
                  loading="lazy"
                />
                <figcaption className="space-y-1 border-t border-border-subtle px-2.5 py-2">
                  {text(item.caption) && (
                    <div className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                      {text(item.caption)}
                    </div>
                  )}
                  <div className="truncate text-[10px] text-text-muted">
                    {text(item.source_id)}
                    {item.page_start != null ? ` · p.${text(item.page_start)}` : ''}
                    {text(item.evidence_id) ? ` · ${text(item.evidence_id)}` : ''}
                  </div>
                </figcaption>
              </figure>
            ))}
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
                  <div className="space-y-1 text-sm leading-relaxed text-text-secondary">
                    {content.map((item, itemIndex) => (
                      <p key={itemIndex}>{item}</p>
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
          <div className="mb-2 text-xs font-medium text-text-muted">证据</div>
          <div className="space-y-2">
            {evidence.slice(0, 6).map((ev) => (
              <div key={text(ev.id)} className="border border-border-subtle bg-elevated p-2.5">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-text-muted">
                  <span>{evidenceTitle(ev)}</span>
                  {text(ev.modality) && <span>{text(ev.modality)}</span>}
                </div>
                <p className="line-clamp-4 text-xs leading-relaxed text-text-secondary">
                  {text(ev.excerpt || ev.snippet)}
                </p>
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
