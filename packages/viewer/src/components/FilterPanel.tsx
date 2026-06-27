import { useAppState } from '@/hooks/useAppState';
import { getSearchMatches } from '@/lib/visibility';
import { TYPE_META, LAYER_MODE_OPTIONS } from '@/lib/constants';
import { BookOpen, Layers, Eye, EyeOff, ChevronDown, ChevronRight, Search, X } from '@/lib/lucide-icons';
import { useMemo, useState, useCallback } from 'react';

type TypeFilterGroup = {
  id: string;
  label: string;
  description: string;
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
      description: '统一知识标准中的顶层对象类型',
    };
  }
  if (CHEM_DOMAIN_TYPES.has(type)) {
    return {
      id: 'chem',
      label: '化学领域分类',
      description: '教材抽取出的化学主题和对象分类',
    };
  }
  if (PROPERTY_RULE_TYPES.has(type)) {
    return {
      id: 'rules',
      label: '性质、规则与参量',
      description: '性质、规则、结构参量和趋势类细分标签',
    };
  }
  return {
    id: 'other',
    label: '其他类型',
    description: '暂未归入固定分组的类型',
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
    knowledgeGraph, selectedNodeId, selectedTypes, selectedBook,
    layerMode, focusConnected, showLabels,
    setSelectedNodeId, setExpandedBackboneNodeId,
    toggleType, resetTypes, setSelectedTypes,
    setSelectedBook, setLayerMode, setFocusConnected,
    setShowLabels, sourceConfigs, switchSource,
    searchTerm,
  } = appState;

  const [typeSectionOpen, setTypeSectionOpen] = useState(true);
  const [typeQuery, setTypeQuery] = useState('');
  const [openTypeGroupIds, setOpenTypeGroupIds] = useState<Set<string>>(() => new Set(['object']));

  const visibilityState = useMemo(() => ({
    knowledgeGraph,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId: appState.expandedBackboneNodeId,
    focusConnected,
    selectedNodeId,
    searchTerm,
    serverSearchHits: appState.serverSearchHits,
  }), [knowledgeGraph, selectedTypes, selectedBook, layerMode, appState.expandedBackboneNodeId, focusConnected, selectedNodeId, searchTerm, appState.serverSearchHits]);

  const searchMatches = useMemo(() => {
    if (!knowledgeGraph) return [];
    return getSearchMatches(visibilityState);
  }, [visibilityState, knowledgeGraph]);

  const books = useMemo(() => {
    if (!knowledgeGraph) return [];
    return Array.from(knowledgeGraph.booksById.keys());
  }, [knowledgeGraph]);

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

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = knowledgeGraph?.nodeById.get(nodeId);
    if (node && node.nodeLayer === 'backbone' && layerMode === 'backbone-expand') {
      setExpandedBackboneNodeId(nodeId);
    }
  }, [knowledgeGraph, layerMode, setSelectedNodeId, setExpandedBackboneNodeId]);

  if (!knowledgeGraph) return null;

  return (
    <aside className="order-2 flex max-h-[38vh] w-full shrink-0 flex-col overflow-hidden border-t border-border-subtle bg-surface lg:order-none lg:max-h-none lg:w-72 lg:border-r lg:border-t-0">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-4">
        {/* Source selector */}
        {sourceConfigs.size > 1 && (
          <section>
            <select
              value={appState.selectedSourceKey || ''}
              onChange={(e) => switchSource(e.target.value)}
              aria-label="选择数据源"
              className="w-full rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-accent"
            >
              {Array.from(sourceConfigs.entries()).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </section>
        )}

        {/* Search results */}
        {searchTerm && (
          <section>
            <div className="mb-1.5 text-xs font-medium text-text-muted">搜索结果 ({searchMatches.length})</div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-thin">
              {searchMatches.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleSelectNode(node.id)}
                  aria-pressed={selectedNodeId === node.id}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedNodeId === node.id
                      ? 'bg-accent/20 text-text-primary'
                      : 'text-text-secondary hover:bg-hover'
                  }`}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_META[node.nodeType]?.color ?? '#9A9AB0' }} />
                  <span className="truncate">{node.name}</span>
                </button>
              ))}
              {searchMatches.length === 0 && (
                <div className="px-2 py-2 text-xs text-text-muted">未找到匹配节点</div>
              )}
            </div>
          </section>
        )}

        {/* Book filter */}
        {books.length > 1 && (
          <section>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
              <BookOpen className="h-3.5 w-3.5" />
              教材筛选
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedBook('all')}
                aria-pressed={selectedBook === 'all'}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  selectedBook === 'all' ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
                }`}
              >
                全部
              </button>
              {books.map((bookId) => (
                <button
                  key={bookId}
                  onClick={() => setSelectedBook(bookId)}
                  aria-pressed={selectedBook === bookId}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    selectedBook === bookId ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
                  }`}
                >
                  {bookId}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Layer mode */}
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <Layers className="h-3.5 w-3.5" />
            显示模式
          </div>
          <div className="flex gap-1">
            {LAYER_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setLayerMode(option.id)}
                aria-pressed={layerMode === option.id}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  layerMode === option.id ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
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
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                focusConnected ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
              }`}
            >
              {focusConnected ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              关联
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              aria-pressed={showLabels}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                showLabels ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
              }`}
            >
              {showLabels ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              标签
            </button>
          </div>
        </section>

        {/* Type filter */}
        <section>
          <button
            onClick={() => setTypeSectionOpen(!typeSectionOpen)}
            className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-text-muted"
          >
            <span>类型筛选 ({selectedTypes.size}/{knowledgeGraph.availableTypes.length})</span>
            {typeSectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {typeSectionOpen && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-text-muted">按知识层级和化学细类分组</div>
                <button
                  onClick={resetTypes}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-hover"
                >
                  全选
                </button>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2 py-1.5">
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
                <div className="rounded-md border border-border-subtle bg-elevated px-3 py-2 text-xs text-text-muted">
                  没有匹配的类型
                </div>
              )}
              {visibleTypeGroups.map((group) => {
                const selectedCount = group.types.filter((type) => selectedTypes.has(type)).length;
                const allSelected = selectedCount === group.types.length;
                const expanded = typeQuery.trim() ? true : openTypeGroupIds.has(group.id);
                return (
                  <div key={group.id} className="rounded-md border border-border-subtle bg-elevated/45">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleTypeGroupOpen(group.id)}
                        aria-expanded={expanded}
                        className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
                      >
                        {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />}
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-text-secondary">
                            {group.label} ({selectedCount}/{group.types.length})
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{group.description}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => toggleTypeGroup(group.types)}
                        className="mr-2 shrink-0 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-hover"
                      >
                        {allSelected ? '清空' : '全选'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="flex flex-wrap gap-1 border-t border-border-subtle p-2">
                        {group.types.map((type) => (
                          <button
                            key={type}
                            onClick={() => toggleType(type)}
                            title={type}
                            aria-pressed={selectedTypes.has(type)}
                            className={`flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                              selectedTypes.has(type)
                                ? 'bg-surface text-text-primary'
                                : 'bg-surface/50 text-text-muted line-through'
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
