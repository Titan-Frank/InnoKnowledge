import type { ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard } from '@okm/types';
import type { LayerMode } from './types/constants.js';

export interface GraphNode extends ApiNode {
  name: string;
  description: string;
  node_type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  radius: number;
  color: string;
  degree: number;
  mentions: ApiMention[];
  profiles: ApiProfile[];
  mentionBookIds: Set<string>;
  scopeBookIds: Set<string>;
}

export interface GraphEdge extends ApiEdge {
  source: GraphNode;
  target: GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeById: Map<string, GraphNode>;
  edgeById: Map<string, GraphEdge>;
  booksById: Map<string, {
    bookId: string;
    outline: Record<string, unknown> | null;
    mentions: ApiMention[];
    evidence: ApiEvidence[];
  }>;
  frameworkTopics: Map<string, Record<string, unknown> & { title: string }>;
  frameworkDomains: Map<string, Record<string, unknown>>;
  patternsById: Map<string, Record<string, unknown>>;
  patternsByType: Map<string, Record<string, unknown>[]>;
  evidenceById: Map<string, ApiEvidence>;
  availableTypes: string[];
  loadWarnings: string[];
  source: Record<string, unknown> & { nodeCardPath?: string };
  manifest: Record<string, unknown> | null;
}

export interface SourceConfig {
  key: string;
  label: string;
  description: string;
  books: Array<{ book_id: string }>;
  hasProfiles: boolean;
  autoDiscovered: boolean;
  bundlePath: string;
  nodeCardPath: string;
}

export interface AppState {
  manifest: Record<string, unknown> | null;
  sourceConfigs: Map<string, SourceConfig>;
  selectedSourceKey: string | null;
  sourceLoading: boolean;
  sourceRequestId: number;
  data: GraphData | null;
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  searchTerm: string;
  selectedBook: string;
  selectedTypes: Set<string>;
  focusConnected: boolean;
  layerMode: LayerMode;
  expandedBackboneNodeId: string | null;
  showLabels: boolean;
  transform: { x: number; y: number; scale: number };
  dragNodeId: string | null;
  panning: boolean;
  lastPointer: { x: number; y: number } | null;
  raf: number | null;
  cardCache: Map<string, ApiNodeCard | null>;
  detailRequestId: number;
  visibleNodesCache: { key: string | null; nodes: GraphNode[] };
}

export function createInitialState(): AppState {
  return {
    manifest: null,
    sourceConfigs: new Map(),
    selectedSourceKey: null,
    sourceLoading: false,
    sourceRequestId: 0,
    data: null,
    selectedNodeId: null,
    hoverNodeId: null,
    searchTerm: '',
    selectedBook: 'all',
    selectedTypes: new Set(),
    focusConnected: false,
    layerMode: 'backbone-expand',
    expandedBackboneNodeId: null,
    showLabels: true,
    transform: { x: 0, y: 0, scale: 1 },
    dragNodeId: null,
    panning: false,
    lastPointer: null,
    raf: null,
    cardCache: new Map(),
    detailRequestId: 0,
    visibleNodesCache: { key: null, nodes: [] },
  };
}
