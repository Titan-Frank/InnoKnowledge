import type { OKMNode } from '@/core/graph/types';
import { MarkdownView } from '@/components/MarkdownView';
import {
  DOMAIN_LABELS,
  KNOWLEDGE_FORM_LABELS,
  LEARNING_MODE_LABELS,
  SCOPE_LABELS,
  TAG_LABELS,
} from '@/lib/constants';

type AttributeGroup = {
  label: string;
  values: string[];
  emphasis?: boolean;
};

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function labelledValues(values: string[], labels: Record<string, string>): string[] {
  return values.map((value) => labels[value] ?? value);
}

function ValuePills({ values, emphasis = false }: { values: string[]; emphasis?: boolean }) {
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5">
      {values.map((value, index) => (
        <li
          key={`${value}:${index}`}
          className={`max-w-full break-words rounded-full border px-2 py-0.5 text-xs ${
            emphasis
              ? 'border-accent/30 bg-accent/10 font-medium text-text-primary'
              : 'border-border-subtle bg-surface text-text-secondary'
          }`}
        >
          {value}
        </li>
      ))}
    </ul>
  );
}

export function DetailObjectOverview({ node }: { node: OKMNode }) {
  const properties = node.properties as Record<string, unknown>;
  const domains = textList(properties.domains);
  const knowledgeForms = textList(properties.knowledge_form);
  const learningModes = textList(properties.learning_modes);
  const explicitTags = textList(properties.tags);
  const tags = explicitTags.length > 0 ? explicitTags : textList(properties.bridge_tags);
  const scope = typeof properties.scope === 'string' && properties.scope.trim()
    ? [properties.scope.trim()]
    : [];

  const attributes: AttributeGroup[] = [
    { label: '领域归属', values: labelledValues(domains, DOMAIN_LABELS) },
    { label: '知识形式', values: labelledValues(knowledgeForms, KNOWLEDGE_FORM_LABELS) },
    { label: '知识维度', values: labelledValues(learningModes, LEARNING_MODE_LABELS), emphasis: true },
    { label: '适用范围', values: labelledValues(scope, SCOPE_LABELS) },
  ].filter((group) => group.values.length > 0);

  const hasOverview = Boolean(node.description) || node.aliases.length > 0;
  const hasAttributes = attributes.length > 0 || tags.length > 0;
  if (!hasOverview && !hasAttributes) return null;

  return (
    <>
      {hasOverview && (
        <section aria-label="对象概览" className="rounded-lg border border-border-subtle bg-elevated p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">对象概览</h3>
          {node.description && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-text-secondary">定义</div>
              <MarkdownView content={node.description} className="text-sm leading-relaxed text-text-secondary" />
            </div>
          )}
          {node.aliases.length > 0 && (
            <div className={node.description ? 'mt-3 border-t border-border-subtle pt-3' : ''}>
              <div className="mb-1.5 text-xs font-medium text-text-secondary">别名</div>
              <ValuePills values={node.aliases} />
            </div>
          )}
        </section>
      )}

      {hasAttributes && (
        <section aria-label="知识属性" className="rounded-lg border border-border-subtle bg-elevated p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">知识属性</h3>
          {attributes.length > 0 && (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2">
              {attributes.map((attribute) => (
                <div key={attribute.label} className="rounded-md border border-border-subtle bg-surface p-3">
                  <dt className="mb-1.5 text-xs font-medium text-text-secondary">{attribute.label}</dt>
                  <dd><ValuePills values={attribute.values} emphasis={attribute.emphasis} /></dd>
                </div>
              ))}
            </dl>
          )}
          {tags.length > 0 && (
            <div className={attributes.length > 0 ? 'mt-3 border-t border-border-subtle pt-3' : ''}>
              <h4 className="mb-1.5 text-xs font-medium text-text-secondary">主题标签</h4>
              <ValuePills values={labelledValues(tags, TAG_LABELS)} />
            </div>
          )}
        </section>
      )}
    </>
  );
}
