import { useAppState } from '@/hooks/useAppState';
import { TYPE_META, LAYER_MODE_OPTIONS } from '@/lib/constants';
import { BookOpen, Layers, Eye, EyeOff, ChevronDown, ChevronRight, Search, X, Filter } from '@/lib/lucide-icons';
import { textbookDisplayTitle } from '@/lib/textbook-display';
import { useMemo, useState, useCallback } from 'react';

type TypeFilterGroup = {
  id: string;
  label: string;
  types: string[];
};

const TOP_OBJECT_TYPES = new Set([
  'entity', 'concept', 'property', 'process', 'event', 'method', 'rule', 'representation', 'resource',
]);

const TYPE_SORT_ORDER = new Map<string, number>([
  ['concept', 10],
  ['entity', 20],
  ['property', 30],
  ['process', 40],
  ['event', 50],
  ['method', 60],
  ['rule', 70],
  ['representation', 80],
  ['resource', 90],
]);

const CHEM_DOMAIN_TYPES = new Set([
  '化学键结构参量',
  '结构性质',
  '晶体宏观形态性质',
  '晶体结构几何属性',
  '晶体物理性质',
  '热学性质',
  'molecular-geometry',
  'orbital geometry',
]);

const PROPERTY_RULE_TYPES = new Set([
  'bond-angle',
  'bond count',
  'bond length',
  'bond property',
  'bonding rule',
  'chemical stability',
  'chemical_structure_prediction_rule',
  'electron-pair-property',
  'electronic-repulsion-rule',
  'geometry-rule',
  'molecular_mass_property',
  'molecular_property',
  'principle_group',
  'property',
  'rule',
  'system energy',
  'thermophysical_property',
  'thermophysical_trend_rule',
]);

function typeLabel(type: string): string {
  return TYPE_META[type]?.label ?? type
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupType(type: string): Omit<TypeFilterGroup, 'types'> {
  if (TOP_OBJECT_TYPES.has(type)) {
    return {
      id: 'object',
      label: '知识对象类型',
    };
  }
  if (CHEM_DOMAIN_TYPES.has(type)) {
    return {
      id: 'chem',
      label: '化学领域分类',
    };
  }
  if (PROPERTY_RULE_TYPES.has(type)) {
    return {
      id: 'rules',
      label: '性质、规则与参量',
    };
  }
  return {
    id: 'other',
    label: '其他类型',
  };
}

function compareTypes(a: string, b: string): number {
  const orderDiff = (TYPE_SORT_ORDER.get(a) ?? 1000) - (TYPE_SORT_ORDER.get(b) ?? 1000);
  if (orderDiff !== 0) return orderDiff;
  return typeLabel(a).localeCompare(typeLabel(b), 'zh-CN');
}

export function FilterPanel() {
  const appState = useAppState();
  const {
    knowledgeGraph, selectedTypes, selectedBook,
    layerMode, focusConnected, showLabels,
    toggleType, resetTypes, setSelectedTypes,
    setSelectedBook, setLayerMode, setFocusConnected,
    setShowLabels,
  } = appState;

  const [typeSectionOpen, setTypeSectionOpen] = useState(true);
  const [typeQuery, setTypeQuery] = useState('');
  const [openTypeGroupIds, setOpenTypeGroupIds] = useState<Set<string>>(() => new Set(['object']));

  const books = useMemo(() => {
    if (!knowledgeGraph) return [];
    return Array.from(knowledgeGraph.booksById.values())
      .map((book) => ({
        id: book.bookId,
        title: textbookDisplayTitle(book.outline),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
  }, [knowledgeGraph]);

  const selectedBookTitle = useMemo(() => (
    selectedBook === 'all'
      ? '全部'
      : books.find((book) => book.id === selectedBook)?.title || selectedBook
  ), [books, selectedBook]);

  const typeGroups = useMemo(() => {
    if (!knowledgeGraph) return [];
    const byId = new Map<string, TypeFilterGroup>();
    for (const type of knowledgeGraph.availableTypes) {
      const group = groupType(type);
      if (!byId.has(group.id)) byId.set(group.id, { ...group, types: [] });
      byId.get(group.id)!.types.push(type);
    }
    const order = ['object', 'chem', 'rules', 'other'];
    return Array.from(byId.values())
      .map((group) => ({
        ...group,
        types: group.types.slice().sort(compareTypes),
      }))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [knowledgeGraph]);

  const visibleTypeGroups = useMemo(() => {
    const query = typeQuery.trim().toLowerCase();
    if (!query) return typeGroups;
    return typeGroups
      .map((group) => ({
        ...group,
        types: group.types.filter((type) => (
          type.toLowerCase().includes(query) ||
          typeLabel(type).toLowerCase().includes(query)
        )),
      }))
      .filter((group) => group.types.length > 0);
  }, [typeGroups, typeQuery]);
  const selectedModeLabel = LAYER_MODE_OPTIONS.find((option) => option.id === layerMode)?.label ?? '当前';
  const visibleTypeCount = selectedTypes.size;

  const toggleTypeGroup = useCallback((types: string[]) => {
    const allSelected = types.every((type) => selectedTypes.has(type));
    const next = new Set(selectedTypes);
    for (const type of types) {
      if (allSelected) next.delete(type);
      else next.add(type);
    }
    setSelectedTypes(next);
  }, [selectedTypes, setSelectedTypes]);

  const toggleTypeGroupOpen = useCallback((groupId: string) => {
    setOpenTypeGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  if (!knowledgeGraph) return null;

  return (
    <aside className="order-2 flex max-h-[30vh] w-full shrink-0 flex-col overflow-hidden border-t border-border-subtle bg-surface/95 shadow-panel backdrop-blur sm:max-h-[36vh] lg:order-none lg:max-h-none lg:w-80 lg:border-r lg:border-t-0">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-accent" />
          <div className="text-sm font-semibold text-text-primary">图谱筛选</div>
        </div>
        <div className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
          {selectedTypes.size}/{knowledgeGraph.availableTypes.length}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-border-subtle bg-elevated/45 px-3 py-2">
        <FilterStat label="类型" value={String(visibleTypeCount)} />
        <FilterStat label="教材" value={selectedBookTitle} />
        <FilterStat label="模式" value={selectedModeLabel} />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin">

        {/* Book filter */}
        {books.length > 1 && (
          <section className="okm-panel-card rounded-lg border border-border-subtle bg-elevated p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
              <BookOpen className="h-3.5 w-3.5" />
              教材筛选
            </div>
            <div className="max-h-28 overflow-y-auto pr-1 scrollbar-thin">
              <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedBook('all')}
                aria-pressed={selectedBook === 'all'}
                className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selectedBook === 'all' ? 'bg-accent text-white' : 'border border-border-subtle bg-surface text-text-secondary hover:bg-hover hover:text-text-primary'
                }`}
              >
                全部
              </button>
              {books.map((book) => (
                <button
                  key={book.id}
                  onClick={() => setSelectedBook(book.id)}
                  aria-pressed={selectedBook === book.id}
                  className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    selectedBook === book.id ? 'bg-accent text-white' : 'border border-border-subtle bg-surface text-text-secondary hover:bg-hover hover:text-text-primary'
                  }`}
                >
                  {book.title}
                </button>
              ))}
              </div>
            </div>
          </section>
        )}

        {/* Layer mode */}
        <section className="okm-panel-card rounded-lg border border-border-subtle bg-elevated p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <Layers className="h-3.5 w-3.5" />
            显示模式
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-subtle bg-surface p-1">
            {LAYER_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setLayerMode(option.id)}
                aria-pressed={layerMode === option.id}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  layerMode === option.id ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Controls */}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setFocusConnected(!focusConnected)}
              aria-pressed={focusConnected}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                focusConnected ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border-subtle bg-surface text-text-secondary hover:bg-hover hover:text-text-primary'
              }`}
            >
              {focusConnected ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              关联
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              aria-pressed={showLabels}
              aria-label={showLabels ? '隐藏节点与关系标签' : '显示节点与关系标签'}
              title={showLabels ? '隐藏节点名称和聚焦关系名称' : '显示节点名称和聚焦关系名称'}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                showLabels ? 'border-accent/50 bg-accent/15 text-accent' : 'border-border-subtle bg-surface text-text-secondary hover:bg-hover hover:text-text-primary'
              }`}
            >
              {showLabels ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              标签
            </button>
          </div>
        </section>

        {/* Type filter */}
        <section className="okm-panel-card rounded-lg border border-border-subtle bg-elevated p-3">
          <button
            onClick={() => setTypeSectionOpen(!typeSectionOpen)}
            className="mb-2 flex w-full items-center justify-between text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            <span>类型筛选 ({selectedTypes.size}/{knowledgeGraph.availableTypes.length})</span>
            {typeSectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {typeSectionOpen && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-text-muted">类型分组</div>
                <button
                  onClick={resetTypes}
                  className="shrink-0 rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                >
                  全选
                </button>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5 transition-colors focus-within:border-accent">
                <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <input
                  value={typeQuery}
                  onChange={(event) => setTypeQuery(event.target.value)}
                  aria-label="筛选类型"
                  placeholder="筛选类型"
                  className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                />
                {typeQuery && (
                  <button
                    type="button"
                    onClick={() => setTypeQuery('')}
                    aria-label="清空类型筛选"
                    className="rounded p-0.5 text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </label>
              {visibleTypeGroups.length === 0 && (
                <div className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-xs text-text-muted">
                  没有匹配的类型
                </div>
              )}
              {visibleTypeGroups.map((group) => {
                const selectedCount = group.types.filter((type) => selectedTypes.has(type)).length;
                const allSelected = selectedCount === group.types.length;
                const expanded = typeQuery.trim() ? true : openTypeGroupIds.has(group.id);
                return (
                  <div key={group.id} className="overflow-hidden rounded-md border border-border-subtle bg-surface">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleTypeGroupOpen(group.id)}
                        aria-expanded={expanded}
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left transition-colors hover:bg-hover"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-text-secondary">
                            {group.label} ({selectedCount}/{group.types.length})
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => toggleTypeGroup(group.types)}
                        className="mr-2 shrink-0 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                      >
                        {allSelected ? '清空' : '全选'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="flex flex-wrap gap-1 border-t border-border-subtle bg-elevated/60 p-2">
                        {group.types.map((type) => (
                          <button
                            key={type}
                            onClick={() => toggleType(type)}
                            title={type}
                            aria-pressed={selectedTypes.has(type)}
                            className={`flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                              selectedTypes.has(type)
                                ? 'bg-surface text-text-primary shadow-sm'
                                : 'bg-surface/60 text-text-muted line-through hover:text-text-secondary'
                            }`}
                          >
                            <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TYPE_META[type]?.color ?? '#9A9AB0' }} />
                            <span className="max-w-[13rem] truncate">{typeLabel(type)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function FilterStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-surface px-2 py-1.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-text-primary">{value}</div>
    </div>
  );
}
