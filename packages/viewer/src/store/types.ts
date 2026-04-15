import type { ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence } from '@okm/types';
import type { LayerMode } from '../constants/index.js';
import type { CommunityInfo } from '../graph/graph-adapter.js';
import type { ThemeMode } from '../components/aiwc/styles/tokens.js';

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
  cardCache: Map<string, import('@okm/types').ApiNodeCard | null>;
  detailRequestId: number;
  visibleNodesCache: { key: string | null; nodes: GraphNode[] };
  communityCount: number;
  communities: CommunityInfo[];
  communityMap: Map<string, number>;
  themeMode: ThemeMode;
}
