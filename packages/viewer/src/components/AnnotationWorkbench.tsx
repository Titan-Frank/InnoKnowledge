import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { EDGE_TYPES as EDGE_TYPE_VALUES, type AnnotationTextbookSummary, type EdgeType, type NodeKind } from '@okm/types';
import { TYPE_META } from '@/lib/constants';
import { loadAnnotationLessonText, loadAnnotationTextbooks } from '@/services/backend-client';
import {
  AlertCircle,
  Check,
  ClipboardList,
  Database,
  Download,
  FileText,
  GitBranch,
  Link,
  Plus,
  Save,
  Tag,
  Trash2,
  Upload,
} from '@/lib/lucide-icons';

type GoldCollection = 'nodes' | 'edges' | 'evidence' | 'negativeItems';

interface GoldMetadata {
  dataset_id: string;
  title: string;
  subject: string;
  scope: string;
  annotator: string;
  version: string;
}

interface GoldLesson {
  lesson_id: string;
  title: string;
  source_ref: string;
  page_start: string;
  page_end: string;
  source_text: string;
}

interface GoldNode {
  gold_node_id: string;
  name: string;
  kind: NodeKind;
  definition: string;
  aliases: string[];
  domains: string[];
  lesson_ids: string[];
  evidence_ids: string[];
  notes: string;
}

interface GoldEdge {
  gold_edge_id: string;
  source: string;
  target: string;
  relation_type: EdgeType;
  direction_note: string;
  lesson_ids: string[];
  evidence_ids: string[];
  notes: string;
}

interface GoldEvidence {
  gold_evidence_id: string;
  lesson_id: string;
  page: string;
  locator: string;
  modality: 'text' | 'image' | 'table' | 'equation';
  excerpt: string;
  source_ref: string;
  notes: string;
}

interface NegativeItem {
  negative_id: string;
  lesson_id: string;
  text: string;
  reason: string;
  evidence_id: string;
}

interface AnnotationData {
  metadata: GoldMetadata;
  lessons: GoldLesson[];
  nodes: GoldNode[];
  edges: GoldEdge[];
  evidence: GoldEvidence[];
  negativeItems: NegativeItem[];
}

const STORAGE_KEY = 'okm.gold.annotation.workbench.v1';

const NODE_KINDS: NodeKind[] = [
  'entity',
  'concept',
  'property',
  'process',
  'event',
  'method',
  'rule',
  'representation',
  'resource',
];

const EDGE_TYPES: EdgeType[] = [...EDGE_TYPE_VALUES];

const EMPTY_DATA: AnnotationData = {
  metadata: {
    dataset_id: 'chem-air-oxygen',
    title: '空气与氧气人工标准集',
    subject: 'chemistry',
    scope: '一个单元或 6 到 10 个课时',
    annotator: '',
    version: 'v0.1',
  },
  lessons: [],
  nodes: [],
  edges: [],
  evidence: [],
  negativeItems: [],
};

const COLLECTION_META: Record<GoldCollection, { label: string; file: string }> = {
  nodes: { label: '标准节点', file: 'gold_nodes.jsonl' },
  edges: { label: '标准关系', file: 'gold_edges.jsonl' },
  evidence: { label: '标准证据', file: 'gold_evidence.jsonl' },
  negativeItems: { label: '不应抽取项', file: 'negative_items.jsonl' },
};

function cloneData(data: AnnotationData): AnnotationData {
  return JSON.parse(JSON.stringify(data)) as AnnotationData;
}

function loadInitialData(): AnnotationData {
  if (typeof window === 'undefined') return cloneData(EMPTY_DATA);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return cloneData(EMPTY_DATA);
  try {
    return { ...cloneData(EMPTY_DATA), ...(JSON.parse(raw) as Partial<AnnotationData>) };
  } catch {
    return cloneData(EMPTY_DATA);
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: string[]): string {
  return value.join('\n');
}

function padNumber(value: number): string {
  return String(value).padStart(3, '0');
}

function nextId(prefix: string, ids: string[]): string {
  const maxValue = ids.reduce((max, id) => {
    const match = id.match(/_(\d+)$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
  return `${prefix}_${padNumber(maxValue + 1)}`;
}

function makeLesson(data: AnnotationData): GoldLesson {
  const lessonId = nextId('lesson', data.lessons.map((item) => item.lesson_id));
  return {
    lesson_id: lessonId,
    title: '',
    source_ref: '',
    page_start: '',
    page_end: '',
    source_text: '',
  };
}

function makeNode(data: AnnotationData, lessonId: string): GoldNode {
  return {
    gold_node_id: nextId('g_node', data.nodes.map((item) => item.gold_node_id)),
    name: '',
    kind: 'concept',
    definition: '',
    aliases: [],
    domains: data.metadata.subject ? [data.metadata.subject] : [],
    lesson_ids: lessonId ? [lessonId] : [],
    evidence_ids: [],
    notes: '',
  };
}

function makeEdge(data: AnnotationData, lessonId: string): GoldEdge {
  return {
    gold_edge_id: nextId('g_edge', data.edges.map((item) => item.gold_edge_id)),
    source: '',
    target: '',
    relation_type: 'related_to',
    direction_note: '',
    lesson_ids: lessonId ? [lessonId] : [],
    evidence_ids: [],
    notes: '',
  };
}

function makeEvidence(data: AnnotationData, lessonId: string): GoldEvidence {
  const lesson = data.lessons.find((item) => item.lesson_id === lessonId);
  return {
    gold_evidence_id: nextId('g_ev', data.evidence.map((item) => item.gold_evidence_id)),
    lesson_id: lessonId,
    page: lesson?.page_start || '',
    locator: '',
    modality: 'text',
    excerpt: '',
    source_ref: lesson?.source_ref || '',
    notes: '',
  };
}

function makeNegativeItem(data: AnnotationData, lessonId: string): NegativeItem {
  return {
    negative_id: nextId('neg', data.negativeItems.map((item) => item.negative_id)),
    lesson_id: lessonId,
    text: '',
    reason: '',
    evidence_id: '',
  };
}

function previewText(value: string, maxLength = 80): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function inferLocator(sourceText: string, selectedText: string): string {
  const source = sourceText || '';
  const target = selectedText.trim();
  if (!source || !target) return '';
  const index = source.indexOf(target);
  if (index < 0) return '';
  const line = source.slice(0, index).split(/\r?\n/).length;
  const span = target.split(/\r?\n/).length;
  return span > 1 ? `第 ${line}-${line + span - 1} 行` : `第 ${line} 行`;
}

function stringifyJsonl<T>(rows: T[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

function parseJsonl<T>(text: string): T[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
    </label>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-md border border-border-subtle bg-elevated px-2.5 py-2 text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
    </label>
  );
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 text-xs text-text-primary outline-none transition-colors focus:border-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
  tone = 'neutral',
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  tone?: 'neutral' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const toneClass = tone === 'accent'
    ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
    : tone === 'danger'
      ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
      : 'border-border-subtle bg-elevated text-text-secondary hover:bg-hover hover:text-text-primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md border px-2 text-xs transition-colors disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 border-l border-border-subtle px-3 first:border-l-0">
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      <div className="mt-0.5 text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

export function AnnotationWorkbench() {
  const [data, setData] = useState<AnnotationData>(() => loadInitialData());
  const [activeCollection, setActiveCollection] = useState<GoldCollection>('nodes');
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [lessonDraft, setLessonDraft] = useState<GoldLesson>(() => makeLesson(data));
  const [nodeDraft, setNodeDraft] = useState<GoldNode>(() => makeNode(data, ''));
  const [edgeDraft, setEdgeDraft] = useState<GoldEdge>(() => makeEdge(data, ''));
  const [evidenceDraft, setEvidenceDraft] = useState<GoldEvidence>(() => makeEvidence(data, ''));
  const [negativeDraft, setNegativeDraft] = useState<NegativeItem>(() => makeNegativeItem(data, ''));
  const [selectedIds, setSelectedIds] = useState<Record<GoldCollection, string | null>>({
    nodes: null,
    edges: null,
    evidence: null,
    negativeItems: null,
  });
  const [sourceBooks, setSourceBooks] = useState<AnnotationTextbookSummary[]>([]);
  const [selectedSourceBookId, setSelectedSourceBookId] = useState('');
  const [selectedSourceLessonId, setSelectedSourceLessonId] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [filter, setFilter] = useState('');
  const [exportPreview, setExportPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setSourceLoading(true);
    setSourceError('');
    loadAnnotationTextbooks()
      .then((payload) => {
        if (cancelled) return;
        setSourceBooks(payload.books);
        const firstBook = payload.books[0];
        if (firstBook) {
          setSelectedSourceBookId((current) => current || firstBook.book_id);
          setSelectedSourceLessonId((current) => current || firstBook.lessons[0]?.lesson_id || '');
        }
      })
      .catch((error) => {
        if (!cancelled) setSourceError((error as Error).message || '教材原文读取失败');
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedLessonId || data.lessons.length === 0) return;
    const firstLesson = data.lessons[0];
    if (firstLesson) {
      setSelectedLessonId(firstLesson.lesson_id);
      setLessonDraft(firstLesson);
      setNodeDraft(makeNode(data, firstLesson.lesson_id));
      setEdgeDraft(makeEdge(data, firstLesson.lesson_id));
      setEvidenceDraft(makeEvidence(data, firstLesson.lesson_id));
      setNegativeDraft(makeNegativeItem(data, firstLesson.lesson_id));
    }
  }, [data, selectedLessonId]);

  useEffect(() => {
    const book = sourceBooks.find((item) => item.book_id === selectedSourceBookId);
    const firstLessonId = book?.lessons[0]?.lesson_id || '';
    setSelectedSourceLessonId((current) => (
      book?.lessons.some((lesson) => lesson.lesson_id === current) ? current : firstLessonId
    ));
  }, [selectedSourceBookId, sourceBooks]);

  const selectedLesson = useMemo(
    () => data.lessons.find((item) => item.lesson_id === selectedLessonId) || null,
    [data.lessons, selectedLessonId],
  );

  const selectedSourceBook = useMemo(
    () => sourceBooks.find((item) => item.book_id === selectedSourceBookId) || null,
    [selectedSourceBookId, sourceBooks],
  );

  const sourceText = lessonDraft.source_text || selectedLesson?.source_text || '';
  const sourceLines = useMemo(() => sourceText.split(/\r?\n/), [sourceText]);

  const stats = useMemo(() => ({
    lessons: data.lessons.length,
    nodes: data.nodes.length,
    edges: data.edges.length,
    evidence: data.evidence.length,
    negative: data.negativeItems.length,
  }), [data]);

  const lessonRows = useMemo(() => {
    if (!selectedLessonId) {
      return {
        nodes: [] as GoldNode[],
        edges: [] as GoldEdge[],
        evidence: [] as GoldEvidence[],
        negativeItems: [] as NegativeItem[],
      };
    }
    return {
      nodes: data.nodes.filter((item) => item.lesson_ids.includes(selectedLessonId)),
      edges: data.edges.filter((item) => item.lesson_ids.includes(selectedLessonId)),
      evidence: data.evidence.filter((item) => item.lesson_id === selectedLessonId),
      negativeItems: data.negativeItems.filter((item) => item.lesson_id === selectedLessonId),
    };
  }, [data.edges, data.evidence, data.negativeItems, data.nodes, selectedLessonId]);

  const activeLessonRows = useMemo(() => {
    const rows = lessonRows[activeCollection];
    if (!filter.trim()) return rows;
    const normalized = filter.trim().toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(normalized));
  }, [activeCollection, filter, lessonRows]);

  const lessonSummary = useMemo(() => ({
    nodes: lessonRows.nodes.length,
    edges: lessonRows.edges.length,
    evidence: lessonRows.evidence.length,
    negative: lessonRows.negativeItems.length,
    nodesWithoutEvidence: lessonRows.nodes.filter((item) => item.evidence_ids.length === 0).length,
    edgesWithoutEvidence: lessonRows.edges.filter((item) => item.evidence_ids.length === 0).length,
  }), [lessonRows]);

  const captureSelection = useCallback(() => {
    const text = window.getSelection()?.toString().trim() || '';
    if (text) setSelectedText(text);
  }, []);

  const fillEvidenceFromSelection = useCallback(() => {
    if (!selectedText.trim()) return;
    setActiveCollection('evidence');
    setSelectedIds((current) => ({ ...current, evidence: null }));
    setEvidenceDraft({
      ...makeEvidence(data, lessonDraft.lesson_id || selectedLessonId),
      page: lessonDraft.page_start,
      locator: inferLocator(sourceText, selectedText),
      excerpt: selectedText,
      source_ref: lessonDraft.source_ref,
    });
  }, [data, lessonDraft.lesson_id, lessonDraft.page_start, lessonDraft.source_ref, selectedLessonId, selectedText, sourceText]);

  const fillNodeFromSelection = useCallback(() => {
    if (!selectedText.trim()) return;
    setActiveCollection('nodes');
    setSelectedIds((current) => ({ ...current, nodes: null }));
    setNodeDraft({
      ...makeNode(data, lessonDraft.lesson_id || selectedLessonId),
      name: previewText(selectedText, 42),
      definition: '',
      notes: `来自原文：${previewText(selectedText, 120)}`,
    });
  }, [data, lessonDraft.lesson_id, selectedLessonId, selectedText]);

  const fillNegativeFromSelection = useCallback(() => {
    if (!selectedText.trim()) return;
    setActiveCollection('negativeItems');
    setSelectedIds((current) => ({ ...current, negativeItems: null }));
    setNegativeDraft({
      ...makeNegativeItem(data, lessonDraft.lesson_id || selectedLessonId),
      text: selectedText,
      reason: '不应作为知识对象抽取',
    });
  }, [data, lessonDraft.lesson_id, selectedLessonId, selectedText]);

  const loadSelectedSourceLesson = useCallback(async () => {
    if (!selectedSourceBookId || !selectedSourceLessonId) return;
    setSourceLoading(true);
    setSourceError('');
    try {
      const payload = await loadAnnotationLessonText(selectedSourceBookId, selectedSourceLessonId);
      const lesson = payload.lesson;
      const importedLesson: GoldLesson = {
        lesson_id: lesson.lesson_id,
        title: `${payload.book.title} / ${lesson.label} ${lesson.title}`.trim(),
        source_ref: `${lesson.source_path}:L${lesson.md_start}-L${lesson.md_end}`,
        page_start: lesson.page_start == null ? '' : String(lesson.page_start),
        page_end: lesson.page_end == null ? '' : String(lesson.page_end),
        source_text: lesson.source_text,
      };
      setLessonDraft(importedLesson);
      setSelectedLessonId(importedLesson.lesson_id);
      setSelectedText('');
      setSelectedIds({ nodes: null, edges: null, evidence: null, negativeItems: null });
      setData((current) => {
        const exists = current.lessons.some((item) => item.lesson_id === importedLesson.lesson_id);
        const lessons = exists
          ? current.lessons.map((item) => item.lesson_id === importedLesson.lesson_id ? importedLesson : item)
          : [...current.lessons, importedLesson];
        return { ...current, lessons };
      });
      setNodeDraft(makeNode(data, importedLesson.lesson_id));
      setEdgeDraft(makeEdge(data, importedLesson.lesson_id));
      setEvidenceDraft(makeEvidence(data, importedLesson.lesson_id));
      setNegativeDraft(makeNegativeItem(data, importedLesson.lesson_id));
    } catch (error) {
      setSourceError((error as Error).message || '课时原文读取失败');
    } finally {
      setSourceLoading(false);
    }
  }, [data, selectedSourceBookId, selectedSourceLessonId]);

  const resetNodeDraft = useCallback(() => {
    setSelectedIds((current) => ({ ...current, nodes: null }));
    setNodeDraft(makeNode(data, selectedLessonId));
  }, [data, selectedLessonId]);

  const resetEdgeDraft = useCallback(() => {
    setSelectedIds((current) => ({ ...current, edges: null }));
    setEdgeDraft(makeEdge(data, selectedLessonId));
  }, [data, selectedLessonId]);

  const resetEvidenceDraft = useCallback(() => {
    setSelectedIds((current) => ({ ...current, evidence: null }));
    setEvidenceDraft(makeEvidence(data, selectedLessonId));
  }, [data, selectedLessonId]);

  const resetNegativeDraft = useCallback(() => {
    setSelectedIds((current) => ({ ...current, negativeItems: null }));
    setNegativeDraft(makeNegativeItem(data, selectedLessonId));
  }, [data, selectedLessonId]);

  const saveLesson = useCallback(() => {
    setData((current) => {
      const exists = current.lessons.some((item) => item.lesson_id === lessonDraft.lesson_id);
      const lessons = exists
        ? current.lessons.map((item) => item.lesson_id === lessonDraft.lesson_id ? lessonDraft : item)
        : [...current.lessons, lessonDraft];
      return { ...current, lessons };
    });
    setSelectedLessonId(lessonDraft.lesson_id);
  }, [lessonDraft]);

  const newLesson = useCallback(() => {
    const draft = makeLesson(data);
    setLessonDraft(draft);
    setSelectedLessonId(draft.lesson_id);
  }, [data]);

  const selectLesson = useCallback((lessonId: string) => {
    const lesson = data.lessons.find((item) => item.lesson_id === lessonId);
    if (!lesson) return;
    setSelectedLessonId(lesson.lesson_id);
    setLessonDraft(lesson);
    setNodeDraft(makeNode(data, lesson.lesson_id));
    setEdgeDraft(makeEdge(data, lesson.lesson_id));
    setEvidenceDraft(makeEvidence(data, lesson.lesson_id));
    setNegativeDraft(makeNegativeItem(data, lesson.lesson_id));
    setSelectedIds({ nodes: null, edges: null, evidence: null, negativeItems: null });
  }, [data]);

  const deleteLesson = useCallback(() => {
    if (!selectedLessonId) return;
    setData((current) => ({
      ...current,
      lessons: current.lessons.filter((item) => item.lesson_id !== selectedLessonId),
    }));
    setSelectedLessonId('');
    setLessonDraft(makeLesson(data));
  }, [data, selectedLessonId]);

  const saveNode = useCallback(() => {
    const exists = data.nodes.some((item) => item.gold_node_id === nodeDraft.gold_node_id);
    const nodes = exists
      ? data.nodes.map((item) => item.gold_node_id === nodeDraft.gold_node_id ? nodeDraft : item)
      : [...data.nodes, nodeDraft];
    const next = { ...data, nodes };
    setData(next);
    setSelectedIds((current) => ({ ...current, nodes: null }));
    setNodeDraft(makeNode(next, selectedLessonId));
  }, [data, nodeDraft, selectedLessonId]);

  const saveEdge = useCallback(() => {
    const exists = data.edges.some((item) => item.gold_edge_id === edgeDraft.gold_edge_id);
    const edges = exists
      ? data.edges.map((item) => item.gold_edge_id === edgeDraft.gold_edge_id ? edgeDraft : item)
      : [...data.edges, edgeDraft];
    const next = { ...data, edges };
    setData(next);
    setSelectedIds((current) => ({ ...current, edges: null }));
    setEdgeDraft(makeEdge(next, selectedLessonId));
  }, [data, edgeDraft, selectedLessonId]);

  const saveEvidence = useCallback(() => {
    const exists = data.evidence.some((item) => item.gold_evidence_id === evidenceDraft.gold_evidence_id);
    const evidence = exists
      ? data.evidence.map((item) => item.gold_evidence_id === evidenceDraft.gold_evidence_id ? evidenceDraft : item)
      : [...data.evidence, evidenceDraft];
    const next = { ...data, evidence };
    setData(next);
    setSelectedIds((current) => ({ ...current, evidence: null }));
    setEvidenceDraft(makeEvidence(next, selectedLessonId));
  }, [data, evidenceDraft, selectedLessonId]);

  const saveNegativeItem = useCallback(() => {
    const exists = data.negativeItems.some((item) => item.negative_id === negativeDraft.negative_id);
    const negativeItems = exists
      ? data.negativeItems.map((item) => item.negative_id === negativeDraft.negative_id ? negativeDraft : item)
      : [...data.negativeItems, negativeDraft];
    const next = { ...data, negativeItems };
    setData(next);
    setSelectedIds((current) => ({ ...current, negativeItems: null }));
    setNegativeDraft(makeNegativeItem(next, selectedLessonId));
  }, [data, negativeDraft, selectedLessonId]);

  const deleteActiveRow = useCallback(() => {
    const selectedId = selectedIds[activeCollection];
    if (!selectedId) return;
    setData((current) => {
      if (activeCollection === 'nodes') {
        return { ...current, nodes: current.nodes.filter((item) => item.gold_node_id !== selectedId) };
      }
      if (activeCollection === 'edges') {
        return { ...current, edges: current.edges.filter((item) => item.gold_edge_id !== selectedId) };
      }
      if (activeCollection === 'evidence') {
        return { ...current, evidence: current.evidence.filter((item) => item.gold_evidence_id !== selectedId) };
      }
      return { ...current, negativeItems: current.negativeItems.filter((item) => item.negative_id !== selectedId) };
    });
    setSelectedIds((current) => ({ ...current, [activeCollection]: null }));
  }, [activeCollection, selectedIds]);

  const selectRow = useCallback((collection: GoldCollection, row: GoldNode | GoldEdge | GoldEvidence | NegativeItem) => {
    setActiveCollection(collection);
    if (collection === 'nodes') {
      const item = row as GoldNode;
      setNodeDraft(item);
      setSelectedIds((current) => ({ ...current, nodes: item.gold_node_id }));
    } else if (collection === 'edges') {
      const item = row as GoldEdge;
      setEdgeDraft(item);
      setSelectedIds((current) => ({ ...current, edges: item.gold_edge_id }));
    } else if (collection === 'evidence') {
      const item = row as GoldEvidence;
      setEvidenceDraft(item);
      setSelectedIds((current) => ({ ...current, evidence: item.gold_evidence_id }));
    } else {
      const item = row as NegativeItem;
      setNegativeDraft(item);
      setSelectedIds((current) => ({ ...current, negativeItems: item.negative_id }));
    }
  }, []);

  const exportAll = useCallback(() => {
    downloadText('lessons.json', JSON.stringify({ metadata: data.metadata, lessons: data.lessons }, null, 2));
    downloadText('gold_nodes.jsonl', stringifyJsonl(data.nodes));
    downloadText('gold_edges.jsonl', stringifyJsonl(data.edges));
    downloadText('gold_evidence.jsonl', stringifyJsonl(data.evidence));
    downloadText('negative_items.jsonl', stringifyJsonl(data.negativeItems));
  }, [data]);

  const refreshExportPreview = useCallback(() => {
    const payload = [
      '# lessons.json',
      JSON.stringify({ metadata: data.metadata, lessons: data.lessons }, null, 2),
      '',
      '# gold_nodes.jsonl',
      stringifyJsonl(data.nodes),
      '',
      '# gold_edges.jsonl',
      stringifyJsonl(data.edges),
      '',
      '# gold_evidence.jsonl',
      stringifyJsonl(data.evidence),
      '',
      '# negative_items.jsonl',
      stringifyJsonl(data.negativeItems),
    ].join('\n');
    setExportPreview(payload);
  }, [data]);

  const handleImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const imported = await Promise.all(files.map(async (file) => ({
      name: file.name,
      text: await file.text(),
    })));
    setData((current) => {
      let next = current;
      for (const file of imported) {
        if (file.name.endsWith('lessons.json')) {
          const parsed = JSON.parse(file.text) as Partial<AnnotationData> & { lessons?: GoldLesson[] };
          next = {
            ...next,
            metadata: { ...next.metadata, ...(parsed.metadata || {}) },
            lessons: parsed.lessons || next.lessons,
          };
        } else if (file.name.endsWith('gold_nodes.jsonl')) {
          next = { ...next, nodes: parseJsonl<GoldNode>(file.text) };
        } else if (file.name.endsWith('gold_edges.jsonl')) {
          next = { ...next, edges: parseJsonl<GoldEdge>(file.text) };
        } else if (file.name.endsWith('gold_evidence.jsonl')) {
          next = { ...next, evidence: parseJsonl<GoldEvidence>(file.text) };
        } else if (file.name.endsWith('negative_items.jsonl')) {
          next = { ...next, negativeItems: parseJsonl<NegativeItem>(file.text) };
        }
      }
      return next;
    });
    event.target.value = '';
  }, []);

  const clearAll = useCallback(() => {
    const next = cloneData(EMPTY_DATA);
    setData(next);
    setSelectedLessonId('');
    setLessonDraft(makeLesson(next));
    setNodeDraft(makeNode(next, ''));
    setEdgeDraft(makeEdge(next, ''));
    setEvidenceDraft(makeEvidence(next, ''));
    setNegativeDraft(makeNegativeItem(next, ''));
    setSelectedIds({ nodes: null, edges: null, evidence: null, negativeItems: null });
    setExportPreview('');
  }, []);

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-void">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList className="h-5 w-5 text-accent" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-text-primary">{data.metadata.title || '人工标准集'}</h1>
            <div className="mt-0.5 truncate text-[11px] text-text-muted">{data.metadata.dataset_id} · {data.metadata.version} · {data.metadata.subject || '未填学科'}</div>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-md border border-border-subtle bg-elevated">
          <Stat label="课时" value={stats.lessons} />
          <Stat label="节点" value={stats.nodes} />
          <Stat label="关系" value={stats.edges} />
          <Stat label="证据" value={stats.evidence} />
          <Stat label="反例" value={stats.negative} />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,.jsonl,application/json"
            onChange={handleImport}
            className="hidden"
          />
          <ToolbarButton title="导入文件" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton title="导出全部" onClick={exportAll} tone="accent">
            <Download className="h-4 w-4" />
            导出
          </ToolbarButton>
          <ToolbarButton title="清空本地草稿" onClick={clearAll} tone="danger">
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(360px,1fr)_360px] xl:grid-cols-[300px_minmax(480px,1fr)_420px]">
        <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-deep scrollbar-thin">
          <div className="space-y-3 border-b border-border-subtle p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Database className="h-4 w-4 text-accent" />
                选择课本
              </div>
              <span className="text-[10px] text-text-muted">{sourceBooks.length} 本</span>
            </div>
            <label htmlFor="annotation-source-book" className="block">
              <span className="mb-1 block text-[11px] font-medium text-text-muted">教材</span>
              <select
                id="annotation-source-book"
                value={selectedSourceBookId}
                onChange={(event) => setSelectedSourceBookId(event.target.value)}
                className="h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 text-xs text-text-primary outline-none transition-colors focus:border-accent"
              >
                {sourceBooks.length === 0 ? (
                  <option value="">无可读原文</option>
                ) : sourceBooks.map((book) => (
                  <option key={book.book_id} value={book.book_id}>{book.title}</option>
                ))}
              </select>
            </label>
            <label htmlFor="annotation-source-lesson" className="block">
              <span className="mb-1 block text-[11px] font-medium text-text-muted">课时</span>
              <select
                id="annotation-source-lesson"
                value={selectedSourceLessonId}
                onChange={(event) => setSelectedSourceLessonId(event.target.value)}
                className="h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 text-xs text-text-primary outline-none transition-colors focus:border-accent"
              >
                {selectedSourceBook?.lessons.length ? selectedSourceBook.lessons.map((lesson) => (
                  <option key={lesson.lesson_id} value={lesson.lesson_id}>
                    {lesson.label} {lesson.title} · {lesson.line_count} 行
                  </option>
                )) : (
                  <option value="">无课时</option>
                )}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <ToolbarButton
                title="读取课时原文"
                onClick={loadSelectedSourceLesson}
                tone="accent"
                disabled={sourceLoading || !selectedSourceBookId || !selectedSourceLessonId}
              >
                <Download className="h-4 w-4" />
                {sourceLoading ? '读取中' : '读取'}
              </ToolbarButton>
              {selectedSourceBook && (
                <span className="min-w-0 truncate text-[11px] text-text-muted">
                  {selectedSourceBook.source_path}
                </span>
              )}
            </div>
            {sourceError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                {sourceError}
              </div>
            )}
          </div>

          <div className="border-b border-border-subtle">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <FileText className="h-4 w-4 text-accent" />
                课时队列
              </div>
              <div className="flex items-center gap-1">
                <ToolbarButton title="新增课时" onClick={newLesson}>
                  <Plus className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton title="保存课时" onClick={saveLesson} tone="accent">
                  <Save className="h-3.5 w-3.5" />
                </ToolbarButton>
              </div>
            </div>
            <div className="max-h-[38vh] overflow-y-auto p-2 scrollbar-thin">
              {data.lessons.length === 0 ? (
                <button
                  type="button"
                  onClick={newLesson}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-default px-3 py-5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  <Plus className="h-4 w-4" />
                  新增课时
                </button>
              ) : data.lessons.map((lesson) => {
                const nodeCount = data.nodes.filter((item) => item.lesson_ids.includes(lesson.lesson_id)).length;
                const evidenceCount = data.evidence.filter((item) => item.lesson_id === lesson.lesson_id).length;
                return (
                  <button
                    type="button"
                    key={lesson.lesson_id}
                    onClick={() => selectLesson(lesson.lesson_id)}
                    className={`mb-1 block w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                      selectedLessonId === lesson.lesson_id
                        ? 'border-accent/40 bg-accent/15'
                        : 'border-border-subtle bg-elevated hover:bg-hover'
                    }`}
                  >
                    <div className="truncate text-xs font-semibold text-text-primary">{lesson.title || lesson.lesson_id}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                      <span className="truncate">{lesson.lesson_id}</span>
                      <span className="shrink-0">{nodeCount} 节点 · {evidenceCount} 证据</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <details className="border-b border-border-subtle">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary">
              标准集信息
            </summary>
            <div className="grid grid-cols-2 gap-2 px-3 pb-3">
              <Field id="gold-dataset-id" label="数据集编号" value={data.metadata.dataset_id} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, dataset_id: value } }))} />
              <Field id="gold-version" label="版本" value={data.metadata.version} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, version: value } }))} />
              <Field id="gold-title" label="名称" value={data.metadata.title} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, title: value } }))} />
              <Field id="gold-subject" label="学科" value={data.metadata.subject} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, subject: value } }))} />
              <Field id="gold-annotator" label="标注人" value={data.metadata.annotator} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, annotator: value } }))} />
              <Field id="gold-scope" label="范围" value={data.metadata.scope} onChange={(value) => setData((current) => ({ ...current, metadata: { ...current.metadata, scope: value } }))} />
            </div>
          </details>

          <details>
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary">
              当前课时字段
            </summary>
            <div className="space-y-2 px-3 pb-3">
              <Field id="lesson-id" label="课时编号" value={lessonDraft.lesson_id} onChange={(value) => setLessonDraft((current) => ({ ...current, lesson_id: value }))} />
              <Field id="lesson-title" label="课时标题" value={lessonDraft.title} onChange={(value) => setLessonDraft((current) => ({ ...current, title: value }))} />
              <Field id="lesson-source-ref" label="来源标识" value={lessonDraft.source_ref} onChange={(value) => setLessonDraft((current) => ({ ...current, source_ref: value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Field id="lesson-page-start" label="起始页" value={lessonDraft.page_start} onChange={(value) => setLessonDraft((current) => ({ ...current, page_start: value }))} />
                <Field id="lesson-page-end" label="结束页" value={lessonDraft.page_end} onChange={(value) => setLessonDraft((current) => ({ ...current, page_end: value }))} />
              </div>
              <TextAreaField id="lesson-source-text" label="课本文本" value={lessonDraft.source_text} onChange={(value) => setLessonDraft((current) => ({ ...current, source_text: value }))} rows={8} />
              <div className="flex gap-2">
                <ToolbarButton title="保存课时" onClick={saveLesson} tone="accent">
                  <Save className="h-4 w-4" />
                  保存
                </ToolbarButton>
                <ToolbarButton title="删除课时" onClick={deleteLesson} tone="danger" disabled={!selectedLessonId}>
                  <Trash2 className="h-4 w-4" />
                  删除
                </ToolbarButton>
              </div>
            </div>
          </details>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border-r border-border-subtle bg-void">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-text-primary">{lessonDraft.title || selectedLesson?.title || '课本原文'}</div>
                <div className="mt-0.5 truncate text-[10px] text-text-muted">
                  {selectedLessonId || lessonDraft.lesson_id} · {lessonDraft.source_ref || '未读取原文'}
                </div>
              </div>
            </div>
            <div className="flex overflow-hidden rounded-md border border-border-subtle bg-elevated">
              <Stat label="节点" value={lessonSummary.nodes} />
              <Stat label="关系" value={lessonSummary.edges} />
              <Stat label="证据" value={lessonSummary.evidence} />
              <Stat label="反例" value={lessonSummary.negative} />
            </div>
          </div>

          <div className="border-b border-border-subtle bg-deep px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
                {selectedText ? previewText(selectedText, 180) : '未选择文本'}
              </div>
            </div>
          </div>

          <div
            onMouseUp={captureSelection}
            onKeyUp={captureSelection}
            className="min-h-0 overflow-auto bg-void p-3 text-xs leading-6 text-text-primary scrollbar-thin"
          >
            {sourceText.trim() ? (
              <div className="font-sans">
                {sourceLines.map((line, index) => (
                  <div key={`${index}:${line.slice(0, 12)}`} className="grid grid-cols-[3.25rem_1fr] gap-3 border-b border-border-subtle/60 py-1 last:border-b-0">
                    <div className="select-none text-right font-mono text-[10px] text-text-muted">{index + 1}</div>
                    <div className="whitespace-pre-wrap break-words">{line || ' '}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-border-default text-xs text-text-muted">
                未读取课时原文
              </div>
            )}
          </div>
        </section>

        <aside className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] bg-deep">
          <div className="border-b border-border-subtle p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Link className="h-4 w-4 text-accent" />
                当前选区
              </div>
              <div className="flex items-center gap-1">
                <ToolbarButton title="删除当前记录" onClick={deleteActiveRow} tone="danger" disabled={!selectedIds[activeCollection]}>
                  <Trash2 className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton title="刷新导出预览" onClick={refreshExportPreview}>
                  <FileText className="h-3.5 w-3.5" />
                </ToolbarButton>
              </div>
            </div>
            <div className="mb-3 min-h-16 rounded-md border border-border-subtle bg-elevated px-3 py-2 text-xs leading-5 text-text-secondary">
              {selectedText ? previewText(selectedText, 240) : '未选择'}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ToolbarButton title="生成证据草稿" onClick={fillEvidenceFromSelection} tone="accent" disabled={!selectedText}>
                <Link className="h-3.5 w-3.5" />
                证据
              </ToolbarButton>
              <ToolbarButton title="生成节点草稿" onClick={fillNodeFromSelection} disabled={!selectedText}>
                <Database className="h-3.5 w-3.5" />
                节点
              </ToolbarButton>
              <ToolbarButton title="生成反例草稿" onClick={fillNegativeFromSelection} disabled={!selectedText}>
                <AlertCircle className="h-3.5 w-3.5" />
                反例
              </ToolbarButton>
            </div>
          </div>

          <div className="border-b border-border-subtle p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {(Object.keys(COLLECTION_META) as GoldCollection[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setActiveCollection(key)}
                  aria-pressed={activeCollection === key}
                  className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    activeCollection === key
                      ? 'border-accent/40 bg-accent text-white'
                      : 'border-border-subtle bg-elevated text-text-secondary hover:bg-hover hover:text-text-primary'
                  }`}
                >
                  {COLLECTION_META[key].label}
                </button>
              ))}
            </div>

            {activeCollection === 'nodes' && (
              <div className="space-y-3">
                <Field id="node-name" label="名称" value={nodeDraft.name} onChange={(value) => setNodeDraft((current) => ({ ...current, name: value }))} />
                <SelectField id="node-kind" label="类型" value={nodeDraft.kind} options={NODE_KINDS} onChange={(value) => setNodeDraft((current) => ({ ...current, kind: value }))} />
                <div className="flex flex-wrap gap-1.5">
                  {NODE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setNodeDraft((current) => ({ ...current, kind }))}
                      className={`rounded px-2 py-1 text-[11px] transition-colors ${
                        nodeDraft.kind === kind ? 'text-white' : 'bg-elevated text-text-secondary hover:bg-hover'
                      }`}
                      style={nodeDraft.kind === kind ? { backgroundColor: TYPE_META[kind]?.color || '#2563eb' } : undefined}
                    >
                      {TYPE_META[kind]?.label || kind}
                    </button>
                  ))}
                </div>
                <TextAreaField id="node-definition" label="短定义" value={nodeDraft.definition} onChange={(value) => setNodeDraft((current) => ({ ...current, definition: value }))} rows={3} />
                <TextAreaField id="node-evidence" label="证据编号" value={joinList(nodeDraft.evidence_ids)} onChange={(value) => setNodeDraft((current) => ({ ...current, evidence_ids: splitList(value) }))} rows={2} />
                <details>
                  <summary className="cursor-pointer text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary">更多字段</summary>
                  <div className="mt-2 space-y-2">
                    <Field id="node-id" label="节点编号" value={nodeDraft.gold_node_id} onChange={(value) => setNodeDraft((current) => ({ ...current, gold_node_id: value }))} />
                    <TextAreaField id="node-aliases" label="别名" value={joinList(nodeDraft.aliases)} onChange={(value) => setNodeDraft((current) => ({ ...current, aliases: splitList(value) }))} rows={2} />
                    <TextAreaField id="node-domains" label="领域" value={joinList(nodeDraft.domains)} onChange={(value) => setNodeDraft((current) => ({ ...current, domains: splitList(value) }))} rows={2} />
                    <TextAreaField id="node-lessons" label="课时编号" value={joinList(nodeDraft.lesson_ids)} onChange={(value) => setNodeDraft((current) => ({ ...current, lesson_ids: splitList(value) }))} rows={2} />
                    <TextAreaField id="node-notes" label="备注" value={nodeDraft.notes} onChange={(value) => setNodeDraft((current) => ({ ...current, notes: value }))} rows={2} />
                  </div>
                </details>
                <div className="flex gap-2">
                  <ToolbarButton title="保存节点" onClick={saveNode} tone="accent">
                    <Check className="h-4 w-4" />
                    保存
                  </ToolbarButton>
                  <ToolbarButton title="新节点" onClick={resetNodeDraft}>
                    <Plus className="h-4 w-4" />
                  </ToolbarButton>
                </div>
              </div>
            )}

            {activeCollection === 'edges' && (
              <div className="space-y-3">
                <Field id="edge-source" label="来源节点" value={edgeDraft.source} onChange={(value) => setEdgeDraft((current) => ({ ...current, source: value }))} />
                <Field id="edge-target" label="目标节点" value={edgeDraft.target} onChange={(value) => setEdgeDraft((current) => ({ ...current, target: value }))} />
                <SelectField id="edge-type" label="关系类型" value={edgeDraft.relation_type} options={EDGE_TYPES} onChange={(value) => setEdgeDraft((current) => ({ ...current, relation_type: value }))} />
                <TextAreaField id="edge-direction" label="方向说明" value={edgeDraft.direction_note} onChange={(value) => setEdgeDraft((current) => ({ ...current, direction_note: value }))} rows={2} />
                <TextAreaField id="edge-evidence" label="证据编号" value={joinList(edgeDraft.evidence_ids)} onChange={(value) => setEdgeDraft((current) => ({ ...current, evidence_ids: splitList(value) }))} rows={2} />
                <details>
                  <summary className="cursor-pointer text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary">更多字段</summary>
                  <div className="mt-2 space-y-2">
                    <Field id="edge-id" label="关系编号" value={edgeDraft.gold_edge_id} onChange={(value) => setEdgeDraft((current) => ({ ...current, gold_edge_id: value }))} />
                    <TextAreaField id="edge-lessons" label="课时编号" value={joinList(edgeDraft.lesson_ids)} onChange={(value) => setEdgeDraft((current) => ({ ...current, lesson_ids: splitList(value) }))} rows={2} />
                    <TextAreaField id="edge-notes" label="备注" value={edgeDraft.notes} onChange={(value) => setEdgeDraft((current) => ({ ...current, notes: value }))} rows={2} />
                  </div>
                </details>
                <div className="flex gap-2">
                  <ToolbarButton title="保存关系" onClick={saveEdge} tone="accent">
                    <Check className="h-4 w-4" />
                    保存
                  </ToolbarButton>
                  <ToolbarButton title="新关系" onClick={resetEdgeDraft}>
                    <Plus className="h-4 w-4" />
                  </ToolbarButton>
                </div>
              </div>
            )}

            {activeCollection === 'evidence' && (
              <div className="space-y-3">
                <TextAreaField id="evidence-excerpt" label="原文摘录" value={evidenceDraft.excerpt} onChange={(value) => setEvidenceDraft((current) => ({ ...current, excerpt: value }))} rows={5} />
                <div className="grid grid-cols-2 gap-2">
                  <Field id="evidence-locator" label="定位" value={evidenceDraft.locator} onChange={(value) => setEvidenceDraft((current) => ({ ...current, locator: value }))} />
                  <SelectField id="evidence-modality" label="证据类型" value={evidenceDraft.modality} options={['text', 'image', 'table', 'equation']} onChange={(value) => setEvidenceDraft((current) => ({ ...current, modality: value }))} />
                </div>
                <TextAreaField id="evidence-notes" label="备注" value={evidenceDraft.notes} onChange={(value) => setEvidenceDraft((current) => ({ ...current, notes: value }))} rows={2} />
                <details>
                  <summary className="cursor-pointer text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary">更多字段</summary>
                  <div className="mt-2 space-y-2">
                    <Field id="evidence-id" label="证据编号" value={evidenceDraft.gold_evidence_id} onChange={(value) => setEvidenceDraft((current) => ({ ...current, gold_evidence_id: value }))} />
                    <Field id="evidence-lesson" label="课时编号" value={evidenceDraft.lesson_id} onChange={(value) => setEvidenceDraft((current) => ({ ...current, lesson_id: value }))} />
                    <Field id="evidence-page" label="页码" value={evidenceDraft.page} onChange={(value) => setEvidenceDraft((current) => ({ ...current, page: value }))} />
                    <Field id="evidence-source-ref" label="来源标识" value={evidenceDraft.source_ref} onChange={(value) => setEvidenceDraft((current) => ({ ...current, source_ref: value }))} />
                  </div>
                </details>
                <div className="flex gap-2">
                  <ToolbarButton title="保存证据" onClick={saveEvidence} tone="accent">
                    <Check className="h-4 w-4" />
                    保存
                  </ToolbarButton>
                  <ToolbarButton title="新证据" onClick={resetEvidenceDraft}>
                    <Plus className="h-4 w-4" />
                  </ToolbarButton>
                </div>
              </div>
            )}

            {activeCollection === 'negativeItems' && (
              <div className="space-y-3">
                <TextAreaField id="negative-text" label="文本" value={negativeDraft.text} onChange={(value) => setNegativeDraft((current) => ({ ...current, text: value }))} rows={4} />
                <TextAreaField id="negative-reason" label="原因" value={negativeDraft.reason} onChange={(value) => setNegativeDraft((current) => ({ ...current, reason: value }))} rows={3} />
                <Field id="negative-evidence" label="证据编号" value={negativeDraft.evidence_id} onChange={(value) => setNegativeDraft((current) => ({ ...current, evidence_id: value }))} />
                <details>
                  <summary className="cursor-pointer text-[11px] font-medium text-text-muted transition-colors hover:text-text-primary">更多字段</summary>
                  <div className="mt-2 space-y-2">
                    <Field id="negative-id" label="反例编号" value={negativeDraft.negative_id} onChange={(value) => setNegativeDraft((current) => ({ ...current, negative_id: value }))} />
                    <Field id="negative-lesson" label="课时编号" value={negativeDraft.lesson_id} onChange={(value) => setNegativeDraft((current) => ({ ...current, lesson_id: value }))} />
                  </div>
                </details>
                <div className="flex gap-2">
                  <ToolbarButton title="保存反例" onClick={saveNegativeItem} tone="accent">
                    <Check className="h-4 w-4" />
                    保存
                  </ToolbarButton>
                  <ToolbarButton title="新反例" onClick={resetNegativeDraft}>
                    <Plus className="h-4 w-4" />
                  </ToolbarButton>
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                {activeCollection === 'nodes' ? <Database className="h-4 w-4 text-accent" /> : activeCollection === 'edges' ? <GitBranch className="h-4 w-4 text-accent" /> : activeCollection === 'negativeItems' ? <AlertCircle className="h-4 w-4 text-accent" /> : <Link className="h-4 w-4 text-accent" />}
                本课结果
              </div>
              <label htmlFor="gold-filter" className="flex min-w-[150px] items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2.5 py-1.5">
                <Tag className="h-3.5 w-3.5 text-text-muted" />
                <input
                  id="gold-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="筛选"
                  className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                />
              </label>
            </div>

            {(lessonSummary.nodesWithoutEvidence > 0 || lessonSummary.edgesWithoutEvidence > 0) && (
              <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                {lessonSummary.nodesWithoutEvidence} 个节点、{lessonSummary.edgesWithoutEvidence} 条关系未关联证据
              </div>
            )}

            {activeLessonRows.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border-default text-xs text-text-muted">
                暂无记录
              </div>
            ) : (
              <div className="space-y-2">
                {activeLessonRows.map((row) => {
                  const id = 'gold_node_id' in row
                    ? row.gold_node_id
                    : 'gold_edge_id' in row
                      ? row.gold_edge_id
                      : 'gold_evidence_id' in row
                        ? row.gold_evidence_id
                        : row.negative_id;
                  const title = 'name' in row
                    ? row.name
                    : 'source' in row
                      ? `${row.source || '未填来源'} -> ${row.target || '未填目标'}`
                      : 'excerpt' in row
                        ? row.excerpt
                        : row.text;
                  const meta = 'kind' in row
                    ? row.kind
                    : 'relation_type' in row
                      ? row.relation_type
                      : 'modality' in row
                        ? row.modality
                        : row.reason;
                  const selected = selectedIds[activeCollection] === id;
                  return (
                    <button
                      type="button"
                      key={id}
                      onClick={() => selectRow(activeCollection, row as GoldNode | GoldEdge | GoldEvidence | NegativeItem)}
                      className={`block w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-accent/40 bg-accent/15'
                          : 'border-border-subtle bg-surface hover:bg-hover'
                      }`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="truncate text-xs font-semibold text-text-primary">{title || id}</span>
                        <span className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-muted">{meta}</span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
                        <span>{id}</span>
                        {'evidence_ids' in row && row.evidence_ids.length > 0 && (
                          <span>证据 {row.evidence_ids.length}</span>
                        )}
                        {'lesson_id' in row && row.lesson_id && (
                          <span>{row.lesson_id}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {exportPreview && (
              <div className="mt-4 border-t border-border-subtle pt-3">
                <TextAreaField id="export-preview" label="导出预览" value={exportPreview} onChange={setExportPreview} rows={10} />
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
