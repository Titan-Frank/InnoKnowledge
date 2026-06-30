import type { ApiProfile, ApiMention, ApiEvidence } from '@okm/types';

export interface OKMNode {
  id: string;
  name: string;
  description: string;
  nodeType: string;        // display type derived from node_kind/node_subkind
  displayTypeLabel: string | null;
  displayColor: string | null;
  nodeKind: string;
  nodeSubkind: string | null;
  nodeLayer: 'backbone' | 'support';
  aliases: string[];
  frameworkRefs: string[];
  properties: Record<string, unknown>;
  degree: number;
  mentions: ApiMention[];
  profiles: ApiProfile[];
  mentionBookIds: Set<string>;
  scopeBookIds: Set<string>;
  communityId: number | null;
}

export interface OKMEdge {
  id: string;
  from: string;
  to: string;
  edgeType: string;
  displayLabel: string | null;
  displayCategory: string | null;
  displayColor: string | null;
  edgeLayer: 'backbone' | 'support';
  backboneExpand: boolean;
  properties: Record<string, unknown>;
}

export interface OKMBook {
  bookId: string;
  outline: Record<string, unknown> | null;
  mentions: ApiMention[];
  evidence: ApiEvidence[];
}

export interface KnowledgeGraph {
  nodes: OKMNode[];
  edges: OKMEdge[];
  nodeById: Map<string, OKMNode>;
  edgeById: Map<string, OKMEdge>;
  booksById: Map<string, OKMBook>;
  frameworkTopics: Map<string, Record<string, unknown> & { title: string }>;
  frameworkDomains: Map<string, Record<string, unknown>>;
  patternsById: Map<string, Record<string, unknown>>;
  patternsByType: Map<string, Record<string, unknown>[]>;
  evidenceById: Map<string, ApiEvidence>;
  availableTypes: string[];
  loadWarnings: string[];
  source: Record<string, unknown> & { nodeCardPath?: string };
  manifest: Record<string, unknown> | null;
  nodeCount: number;
  edgeCount: number;
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

export interface SearchHitMeta {
  score: number;
  text_match: boolean;
  vector_match: boolean;
  similarity: number | null;
}

export type ThemeMode = 'dark' | 'light';

export type LayerMode = 'backbone-expand' | 'all';
