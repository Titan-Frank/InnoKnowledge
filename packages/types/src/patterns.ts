export interface PatternLibrary {
  library_id?: string;
  title?: string;
  patterns: Pattern[];
}

export interface Pattern {
  [key: string]: unknown;
  id: string;
  node_kind: string;
  node_type?: string;
  node_subkind?: string;
  title: string;
  summary: string;
  sections: PatternSection[];
  recommended_edge_types: string[];
  properties: Record<string, unknown>;
}

export interface PatternSections {
  id: string;
  title: string;
  section_type: string;
  required: boolean;
  prompt: string;
}

export type PatternSection = PatternSections;
