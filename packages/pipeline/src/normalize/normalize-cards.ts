export type NodeCardSectionLike = {
  id?: unknown;
  title?: unknown;
  section_type?: unknown;
  content?: unknown;
  [key: string]: unknown;
};

export type NodeCardLike = {
  node_id: string;
  sections_json: unknown;
};

export type NormalizedCardSectionsResult = {
  node_id: string;
  sections_json: unknown[];
  modified: boolean;
};

export function normalizeNodeCardSections(card: NodeCardLike): NormalizedCardSectionsResult {
  const sections = Array.isArray(card.sections_json) ? cloneSections(card.sections_json) : [];
  let modified = false;

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!isRecord(section)) continue;
    if (!section.id) {
      section.id = `section-${index}`;
      modified = true;
    }
    if (!section.title) {
      section.title = section.id;
      modified = true;
    }
    if (!section.section_type) {
      section.section_type = "other";
      modified = true;
    }
    const content = section.content;
    if (Array.isArray(content)) {
      const cleaned = content.map((item) => String(item).trim()).filter((item) => item.length > 0);
      if (!arraysEqual(cleaned, content)) {
        section.content = cleaned;
        modified = true;
      }
    }
  }

  return {
    node_id: card.node_id,
    sections_json: sections,
    modified,
  };
}

export function normalizeNodeCardRows(cards: NodeCardLike[]): NormalizedCardSectionsResult[] {
  return cards.map(normalizeNodeCardSections);
}

export function countModifiedCards(cards: NodeCardLike[]): number {
  return normalizeNodeCardRows(cards).filter((card) => card.modified).length;
}

function cloneSections(sections: unknown[]): unknown[] {
  return sections.map((section) => (isRecord(section) ? { ...section } : section));
}

function arraysEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is NodeCardSectionLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
