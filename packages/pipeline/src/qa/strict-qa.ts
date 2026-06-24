import {
  VALID_CURRICULUM_ROLES,
  VALID_DOMAINS,
  VALID_EDGE_TYPES,
  VALID_LEARNING_MODES,
  VALID_NODE_KINDS,
  VALID_SCHOOL_STAGES,
} from "../shared/knowledge.js";

export type StrictQaIssue = {
  category: string;
  id: string;
  message: string;
};

export type StrictQaRows = {
  nodes: Array<{
    id: string;
    kind: string;
    name?: string | null;
    definition?: string | null;
    domains_json?: unknown;
    learning_mode_json?: unknown;
  }>;
  edges: Array<{
    id: string;
    type: string;
    directionality: string;
    from_id: string;
    to_id: string;
    source_refs_json?: unknown;
  }>;
  domain_profiles: Array<{
    id: string;
    node_id: string;
    domain: string;
    school_stages_json?: unknown;
    curriculum_roles_json?: unknown;
    source_refs_json?: unknown;
  }>;
  mentions: Array<{
    id: string;
    target_id: string;
    source_refs_json?: unknown;
  }>;
  evidence: Array<{
    id: string;
  }>;
  node_cards: Array<{
    node_id: string;
    summary?: string | null;
    source_refs_json?: unknown;
    sections_json?: unknown;
  }>;
};

export type StrictQaResult = {
  status: "success" | "blocked";
  errors: StrictQaIssue[];
  warnings: StrictQaIssue[];
};

const REQUIRED_CARD_SECTIONS = new Set(["definition", "essence", "key_points", "example", "application", "misconception"]);

export function runStrictQa(rows: StrictQaRows): StrictQaResult {
  const qa = new StrictQaRunner(rows);
  const result = qa.run();
  return {
    status: result.errors.length === 0 ? "success" : "blocked",
    ...result,
  };
}

class StrictQaRunner {
  private readonly errors: StrictQaIssue[] = [];
  private readonly warnings: StrictQaIssue[] = [];
  private readonly nodeIds: Set<string>;
  private readonly evidenceIds: Set<string>;
  private readonly cardNodeIds: Set<string>;
  private readonly mentionTargetIds: Set<string>;
  private readonly profileNodeIds: Set<string>;

  constructor(private readonly rows: StrictQaRows) {
    this.nodeIds = new Set(rows.nodes.map((row) => row.id));
    this.evidenceIds = new Set(rows.evidence.map((row) => row.id));
    this.cardNodeIds = new Set(rows.node_cards.map((row) => row.node_id));
    this.mentionTargetIds = new Set(rows.mentions.map((row) => row.target_id));
    this.profileNodeIds = new Set(rows.domain_profiles.map((row) => row.node_id));
  }

  run(): Omit<StrictQaResult, "status"> {
    this.validateNodes();
    this.validateEdges();
    this.validateDomainProfiles();
    this.validateMentionsAndEvidence();
    this.validateNodeCards();
    return { errors: this.errors, warnings: this.warnings };
  }

  private error(category: string, id: string, message: string): void {
    this.errors.push({ category, id, message });
  }

  private validateSourceRefs(category: string, itemId: string, sourceRefs: unknown, options: { required?: boolean } = {}): void {
    const required = options.required ?? true;
    const refs = Array.isArray(sourceRefs) ? sourceRefs : [];
    if (required && refs.length === 0) {
      this.error(category, itemId, "Missing evidence source references");
      return;
    }
    for (const evidenceId of refs) {
      if (typeof evidenceId !== "string" || !evidenceId.trim()) {
        this.error(category, itemId, "Invalid empty evidence reference");
        continue;
      }
      if (!this.evidenceIds.has(evidenceId)) {
        this.error(category, itemId, `Missing evidence ${evidenceId}`);
      }
    }
  }

  private validateNodes(): void {
    for (const row of this.rows.nodes) {
      if (!VALID_NODE_KINDS.has(row.kind)) {
        this.error("node", row.id, `Invalid kind: ${row.kind}`);
      }
      if (!row.name || !row.definition) {
        this.error("node", row.id, "Missing name or definition");
      }
      const domains = Array.isArray(row.domains_json) ? row.domains_json : null;
      if (!domains || domains.length === 0) {
        this.error("node", row.id, "domains_json must be a non-empty array");
      } else {
        const invalid = domains.filter((item) => !VALID_DOMAINS.has(String(item)));
        if (invalid.length > 0) this.error("node", row.id, `Invalid domains: ${formatPythonStringList(invalid)}`);
      }
      const learningModes = Array.isArray(row.learning_mode_json) ? row.learning_mode_json : null;
      if (!learningModes || learningModes.length === 0) {
        this.error("node", row.id, "learning_mode_json must be a non-empty array");
      } else {
        const invalid = learningModes.filter((item) => !VALID_LEARNING_MODES.has(String(item)));
        if (invalid.length > 0) this.error("node", row.id, `Invalid learning modes: ${formatPythonStringList(invalid)}`);
      }
      if (!this.cardNodeIds.has(row.id)) this.error("node_card", row.id, "Missing node card");
      if (!this.mentionTargetIds.has(row.id)) this.error("mention", row.id, "Missing mention");
      if (!this.profileNodeIds.has(row.id)) this.error("domain_profile", row.id, "Missing domain profile");
    }
  }

  private validateEdges(): void {
    for (const row of this.rows.edges) {
      if (!VALID_EDGE_TYPES.has(row.type)) this.error("edge", row.id, `Invalid edge type: ${row.type}`);
      if (row.directionality !== "directed" && row.directionality !== "undirected") this.error("edge", row.id, `Invalid directionality: ${row.directionality}`);
      this.validateSourceRefs("edge", row.id, row.source_refs_json);
      if (!this.nodeIds.has(row.from_id)) this.error("edge", row.id, "Missing source node");
      if (!this.nodeIds.has(row.to_id)) this.error("edge", row.id, "Missing target node");
    }
  }

  private validateDomainProfiles(): void {
    for (const row of this.rows.domain_profiles) {
      if (!VALID_DOMAINS.has(row.domain)) this.error("domain_profile", row.id, `Invalid domain: ${row.domain}`);
      const invalidStages = (Array.isArray(row.school_stages_json) ? row.school_stages_json : []).filter((item) => !VALID_SCHOOL_STAGES.has(String(item)));
      if (invalidStages.length > 0) this.error("domain_profile", row.id, `Invalid school stages: ${formatPythonStringList(invalidStages)}`);
      const invalidRoles = (Array.isArray(row.curriculum_roles_json) ? row.curriculum_roles_json : []).filter((item) => !VALID_CURRICULUM_ROLES.has(String(item)));
      if (invalidRoles.length > 0) this.error("domain_profile", row.id, `Invalid curriculum roles: ${formatPythonStringList(invalidRoles)}`);
      this.validateSourceRefs("domain_profile", row.id, row.source_refs_json);
    }
  }

  private validateMentionsAndEvidence(): void {
    for (const row of this.rows.mentions) {
      this.validateSourceRefs("mention", row.id, row.source_refs_json);
    }
  }

  private validateNodeCards(): void {
    for (const row of this.rows.node_cards) {
      if (!row.summary) this.error("node_card", row.node_id, "Missing summary");
      this.validateSourceRefs("node_card", row.node_id, row.source_refs_json);
      const sections = Array.isArray(row.sections_json) ? row.sections_json : [];
      const sectionTypes = new Set(sections.filter(isRecord).map((section) => section.section_type));
      const missing = [...REQUIRED_CARD_SECTIONS].filter((section) => !sectionTypes.has(section)).sort();
      if (missing.length > 0) this.error("node_card", row.node_id, `Missing required sections: ${formatPythonStringList(missing)}`);
      for (const section of sections) {
        if (!isRecord(section)) continue;
        const sectionId = String(section.id || section.section_type || "section");
        this.validateSourceRefs("node_card_section", `${row.node_id}:${sectionId}`, section.source_refs);
      }
    }
  }
}

function formatPythonStringList(values: unknown[]): string {
  return `[${values.map((value) => (typeof value === "string" ? `'${value}'` : String(value))).join(", ")}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
