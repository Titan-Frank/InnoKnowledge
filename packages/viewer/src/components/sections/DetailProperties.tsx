import type { OKMNode } from '@/core/graph/types';
import { humanizeKey } from '@/core/graph/knowledge-data';
import { BRIDGE_TAG_LABELS, DOMAIN_LABELS } from '@/lib/constants';

type PrimitiveValue = string | number | boolean | null | undefined;

const SKIP_KEYS = new Set([
  'id',
  'source_id',
  'source_ids',
  'book_id',
  'anchor',
  'anchor_ref',
  'chunk_id',
  'chunk_ids',
  'batch_anchor',
  'learning_modes',
  'bridge_tags',
  'node_layer',
  'node_type',
  'node_kind',
  'node_subkind',
  'backbone',
  'support',
]);

const PROPERTY_LABELS: Record<string, string> = {
  semantic_core: '语义核心',
  template_display: '展示模板',
  extraction_template: '抽取模板',
  domains: '领域',
  knowledge_form: '知识形式',
  scope: '范围',
  tags: '标签',
  core_claims: '核心命题',
  formal_expressions: '公式与表达',
  conditions: '成立条件',
  boundaries: '适用边界',
  counterexamples: '反例',
  misconceptions: '常见误解',
  id: '编号',
  template_id: '模板编号',
  type_key: '类型键',
  label: '标签',
  color: '颜色',
  version: '版本',
  name: '名称',
};

const VALUE_LABELS: Record<string, string> = {
  ...DOMAIN_LABELS,
  ...BRIDGE_TAG_LABELS,
  general: '通用',
  propositional: '命题式',
  practical: '实践式',
  universal: '通用',
  'domain-specific': '领域特定',
  'culture-specific': '文化特定',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is PrimitiveValue {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (isRecord(value)) return Object.values(value).every(isEmptyValue);
  return false;
}

function propertyLabel(key: string): string {
  return PROPERTY_LABELS[key] ?? humanizeKey(key);
}

function primitiveText(value: PrimitiveValue): string {
  if (value == null) return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  const text = String(value);
  return VALUE_LABELS[text] ?? text;
}

function isColorValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function PropertyValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isPrimitive(value)) {
    return (
      <span className="break-words text-text-secondary">
        {primitiveText(value)}
      </span>
    );
  }

  if (Array.isArray(value)) {
    const items = value.filter((item) => !isEmptyValue(item));
    if (items.length === 0) return <span className="text-text-muted">无</span>;

    if (items.every(isPrimitive)) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <span key={`${String(item)}:${index}`} className="rounded-md border border-border-subtle bg-elevated px-2 py-0.5 text-xs text-text-secondary">
              {primitiveText(item as PrimitiveValue)}
            </span>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div key={index} className="rounded-md border border-border-subtle bg-elevated/70 px-2.5 py-2">
            <div className="mb-1 text-[11px] text-text-muted">第 {index + 1} 项</div>
            <PropertyValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (!isRecord(value)) {
    return <span className="break-words text-text-secondary">{String(value)}</span>;
  }

  const entries = Object.entries(value).filter(([, item]) => !isEmptyValue(item));
  if (entries.length === 0) return <span className="text-text-muted">无</span>;

  if (depth >= 3) {
    return (
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-elevated/70 p-2 font-mono text-[11px] leading-5 text-text-secondary scrollbar-thin">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map(([key, item]) => {
        const color = isColorValue(item);
        return (
          <div key={key} className="grid gap-1 rounded-md border border-border-subtle bg-elevated/70 px-2.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="text-[11px] font-medium text-text-muted">{propertyLabel(key)}</div>
            <div className="min-w-0 text-xs leading-5">
              {color ? (
                <span className="inline-flex items-center gap-2 text-text-secondary">
                  <span className="h-3 w-3 rounded-full border border-border-default" style={{ backgroundColor: item }} />
                  {item}
                </span>
              ) : (
                <PropertyValue value={item} depth={depth + 1} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DetailProperties({ node }: { node: OKMNode }) {
  const props = node.properties as Record<string, unknown>;
  if (!props) return null;

  const entries = Object.entries(props).filter(([key, value]) => !SKIP_KEYS.has(key) && !isEmptyValue(value));
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="mb-2 text-sm font-semibold text-text-primary">属性</div>
      <div className="space-y-1.5">
        {entries.map(([key, value]) => {
          const complex = Array.isArray(value) || isRecord(value);
          return (
            <div key={key} className={`rounded-md bg-surface px-2.5 py-2 text-sm ${complex ? 'space-y-2' : 'flex flex-wrap gap-2'}`}>
              <span className="shrink-0 text-text-muted">{propertyLabel(key)}</span>
              <div className="min-w-0 flex-1">
                <PropertyValue value={value} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
