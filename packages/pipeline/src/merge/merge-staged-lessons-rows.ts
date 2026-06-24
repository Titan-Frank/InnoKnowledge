import { canonicalCandidatesFromRows, type StagedLessonMergeInput } from "./merge-staged-lesson.js";
import type { CanonicalNodeCandidate } from "./merge-nodes.js";

type RawRecord = Record<string, unknown>;

export type MergeFetchedStagingRows = {
  nodes?: RawRecord[];
  evidence?: RawRecord[];
  edges?: RawRecord[];
  domain_profiles?: RawRecord[];
  mentions?: RawRecord[];
  node_cards?: RawRecord[];
};

export type MergeRowsInput = {
  lessonRuns: RawRecord[];
  canonicalNodeRows: RawRecord[];
  staged: MergeFetchedStagingRows;
};

export type MergeRowsPlanInput = {
  lessons: StagedLessonMergeInput[];
  canonicalNodes: CanonicalNodeCandidate[];
};

export function buildMergeRowsPlanInput(input: MergeRowsInput): MergeRowsPlanInput {
  return {
    lessons: buildStagedLessonInputs(input.lessonRuns, input.staged),
    canonicalNodes: canonicalCandidatesFromRows(input.canonicalNodeRows),
  };
}

export function buildStagedLessonInputs(lessonRuns: RawRecord[], staged: MergeFetchedStagingRows): StagedLessonMergeInput[] {
  return lessonRuns.map((lessonRun) => {
    const lessonRunId = requiredString(lessonRun.lesson_run_id, "lesson_run_id");
    return {
      lesson_run_id: lessonRunId,
      staged: {
        nodes: rowsForLesson(staged.nodes, lessonRunId),
        evidence: rowsForLesson(staged.evidence, lessonRunId),
        edges: rowsForLesson(staged.edges, lessonRunId),
        domain_profiles: rowsForLesson(staged.domain_profiles, lessonRunId),
        mentions: rowsForLesson(staged.mentions, lessonRunId),
        node_cards: rowsForLesson(staged.node_cards, lessonRunId),
      },
    };
  });
}

export function indexRowsByStringKey(rows: RawRecord[], key = "id"): Record<string, RawRecord> {
  const result: Record<string, RawRecord> = {};
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "string" || value.length === 0) continue;
    result[value] = row;
  }
  return result;
}

export function evidenceIdsFromRows(rows: RawRecord[]): string[] {
  const result: string[] = [];
  for (const row of rows) {
    if (typeof row.id === "string" && row.id.length > 0) result.push(row.id);
  }
  return result;
}

function rowsForLesson(rows: RawRecord[] | undefined, lessonRunId: string): RawRecord[] {
  return (rows ?? []).filter((row) => row.lesson_run_id === lessonRunId);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}
