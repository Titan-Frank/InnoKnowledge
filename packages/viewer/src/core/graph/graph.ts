import type { KnowledgeGraph, OKMNode, OKMEdge, OKMBook } from './types';
import type { ApiEvidence } from '@okm/types';

export function createKnowledgeGraph(partial: {
  nodes: OKMNode[];
  edges: OKMEdge[];
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
}): KnowledgeGraph {
  const nodeById = new Map<string, OKMNode>();
  const edgeById = new Map<string, OKMEdge>();

  for (const node of partial.nodes) {
    nodeById.set(node.id, node);
  }
  for (const edge of partial.edges) {
    edgeById.set(edge.id, edge);
  }

  return {
    nodes: partial.nodes,
    edges: partial.edges,
    nodeById,
    edgeById,
    booksById: partial.booksById,
    frameworkTopics: partial.frameworkTopics,
    frameworkDomains: partial.frameworkDomains,
    patternsById: partial.patternsById,
    patternsByType: partial.patternsByType,
    evidenceById: partial.evidenceById,
    availableTypes: partial.availableTypes,
    loadWarnings: partial.loadWarnings,
    source: partial.source,
    manifest: partial.manifest,
    nodeCount: partial.nodes.length,
    edgeCount: partial.edges.length,
  };
}
