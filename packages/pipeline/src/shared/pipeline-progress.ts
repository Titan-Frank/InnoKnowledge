import postgres from "postgres";
import { DATASET_ADVISORY_LOCK_SQL } from "./dataset-transaction.js";

export type PipelineJobStatus = "running" | "completed" | "blocked";
export type PipelineStageStatus = "pending" | "running" | "completed" | "blocked" | "skipped";
export type PipelineWorkerStatus = "idle" | "running" | "completed" | "failed";

export type PipelineProgressStage = {
  stageId: string;
  status: PipelineStageStatus;
  sortOrder: number;
  label?: string;
  progress?: Record<string, unknown>;
  error?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type PipelineProgressEvent = {
  stageId: string;
  eventType: string;
  status?: string;
  workerSlot?: number;
  lessonRunId?: string;
  batchAnchor?: string;
  detail?: string;
  data?: Record<string, unknown>;
};

export type PipelineWorkerState = {
  workerSlot: number;
  stageId: string;
  status: PipelineWorkerStatus;
  lessonRunId?: string;
  batchAnchor?: string;
  error?: string;
  data?: Record<string, unknown>;
};

export type PipelineStartInput = {
  datasetId: string;
  jobId: string;
  bookId: string;
  logPath?: string;
  command?: string[];
  context?: Record<string, unknown>;
};

export type PipelineProgressStore = {
  startJob(input: PipelineStartInput): Promise<void>;
  updateJob(input: {
    datasetId: string;
    jobId: string;
    status: PipelineJobStatus;
    currentStageId?: string | null;
    progress?: Record<string, unknown>;
    error?: string | null;
    completed?: boolean;
  }): Promise<void>;
  upsertStage(input: {
    datasetId: string;
    jobId: string;
    stage: PipelineProgressStage;
  }): Promise<void>;
  addEvent(input: {
    datasetId: string;
    jobId: string;
    event: PipelineProgressEvent;
  }): Promise<void>;
  setWorkerState(input: {
    datasetId: string;
    jobId: string;
    worker: PipelineWorkerState;
  }): Promise<void>;
  close(): Promise<void>;
};

export function createNoopPipelineProgressStore(): PipelineProgressStore {
  return {
    async startJob() {},
    async updateJob() {},
    async upsertStage() {},
    async addEvent() {},
    async setWorkerState() {},
    async close() {},
  };
}

export function createPostgresPipelineProgressStore(databaseUrl: string): PipelineProgressStore {
  const sql = postgres(databaseUrl, { max: 3 });
  return {
    async startJob(input) {
      await startPostgresPipelineJob(sql, input);
    },
    async updateJob(input) {
      const now = nowIso();
      await sql`
        UPDATE world_pipeline_jobs
        SET status = ${input.status},
            current_stage_id = ${input.currentStageId ?? null},
            progress_json = ${sql.json(toJson(input.progress ?? {}))},
            error = ${input.error ?? null},
            updated_at = ${now},
            completed_at = ${input.completed ? now : null}
        WHERE dataset_id = ${input.datasetId}
          AND job_id = ${input.jobId}
      `;
    },
    async upsertStage(input) {
      const now = nowIso();
      const startedAt = input.stage.startedAt === undefined
        ? (input.stage.status === "running" ? now : null)
        : input.stage.startedAt;
      const completedAt = input.stage.completedAt === undefined
        ? (isTerminalStageStatus(input.stage.status) ? now : null)
        : input.stage.completedAt;
      await sql`
        INSERT INTO world_pipeline_job_stages (
          dataset_id, job_id, stage_id, status, sort_order, label,
          progress_json, error, started_at, completed_at, updated_at
        )
        VALUES (
          ${input.datasetId}, ${input.jobId}, ${input.stage.stageId},
          ${input.stage.status}, ${input.stage.sortOrder}, ${input.stage.label ?? input.stage.stageId},
          ${sql.json(toJson(input.stage.progress ?? {}))}, ${input.stage.error ?? null},
          ${startedAt}, ${completedAt}, ${now}
        )
        ON CONFLICT (dataset_id, job_id, stage_id) DO UPDATE SET
          status = EXCLUDED.status,
          sort_order = EXCLUDED.sort_order,
          label = EXCLUDED.label,
          progress_json = EXCLUDED.progress_json,
          error = EXCLUDED.error,
          started_at = CASE
            WHEN EXCLUDED.status = 'running' THEN EXCLUDED.started_at
            ELSE COALESCE(world_pipeline_job_stages.started_at, EXCLUDED.started_at)
          END,
          completed_at = CASE
            WHEN EXCLUDED.status = 'running' THEN NULL
            ELSE COALESCE(EXCLUDED.completed_at, world_pipeline_job_stages.completed_at)
          END,
          updated_at = EXCLUDED.updated_at
      `;
    },
    async addEvent(input) {
      await sql`
        INSERT INTO world_pipeline_job_events (
          dataset_id, job_id, event_id, stage_id, event_type, status,
          worker_slot, lesson_run_id, batch_anchor, detail, data_json, created_at
        )
        VALUES (
          ${input.datasetId}, ${input.jobId}, ${eventId()},
          ${input.event.stageId}, ${input.event.eventType}, ${input.event.status ?? null},
          ${input.event.workerSlot ?? null}, ${input.event.lessonRunId ?? null},
          ${input.event.batchAnchor ?? null}, ${input.event.detail ?? null},
          ${sql.json(toJson(input.event.data ?? {}))}, ${nowIso()}
        )
      `;
    },
    async setWorkerState(input) {
      const now = nowIso();
      await sql`
        INSERT INTO world_pipeline_worker_states (
          dataset_id, job_id, worker_slot, stage_id, status,
          lesson_run_id, batch_anchor, error, data_json,
          started_at, completed_at, updated_at
        )
        VALUES (
          ${input.datasetId}, ${input.jobId}, ${input.worker.workerSlot},
          ${input.worker.stageId}, ${input.worker.status},
          ${input.worker.lessonRunId ?? null}, ${input.worker.batchAnchor ?? null},
          ${input.worker.error ?? null}, ${sql.json(toJson(input.worker.data ?? {}))},
          ${input.worker.status === "running" ? now : null},
          ${input.worker.status === "completed" || input.worker.status === "failed" ? now : null},
          ${now}
        )
        ON CONFLICT (dataset_id, job_id, worker_slot) DO UPDATE SET
          stage_id = EXCLUDED.stage_id,
          status = EXCLUDED.status,
          lesson_run_id = EXCLUDED.lesson_run_id,
          batch_anchor = EXCLUDED.batch_anchor,
          error = EXCLUDED.error,
          data_json = EXCLUDED.data_json,
          started_at = CASE
            WHEN EXCLUDED.status = 'running' THEN EXCLUDED.started_at
            ELSE world_pipeline_worker_states.started_at
          END,
          completed_at = EXCLUDED.completed_at,
          updated_at = EXCLUDED.updated_at
      `;
    },
    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}

export async function startPostgresPipelineJob(
  sql: postgres.Sql,
  input: PipelineStartInput,
  now = nowIso(),
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(DATASET_ADVISORY_LOCK_SQL, [input.datasetId]);
    await tx`
      INSERT INTO world_pipeline_jobs (
        dataset_id, job_id, book_id, status, current_stage_id,
        progress_json, log_path, command_json, context_json,
        created_at, updated_at, completed_at, error
      )
      VALUES (
        ${input.datasetId}, ${input.jobId}, ${input.bookId}, 'running', NULL,
        ${tx.json(toJson({}))}, ${input.logPath ?? null}, ${tx.json(toJson(input.command ?? []))}, ${tx.json(toJson(input.context ?? {}))},
        ${now}, ${now}, NULL, NULL
      )
      ON CONFLICT (dataset_id, job_id) DO UPDATE SET
        book_id = EXCLUDED.book_id,
        status = 'running',
        current_stage_id = NULL,
        progress_json = '{}'::jsonb,
        log_path = EXCLUDED.log_path,
        command_json = EXCLUDED.command_json,
        context_json = EXCLUDED.context_json,
        updated_at = EXCLUDED.updated_at,
        completed_at = NULL,
        error = NULL
    `;
  });
}

function isTerminalStageStatus(status: PipelineStageStatus): boolean {
  return status === "completed" || status === "blocked" || status === "skipped";
}

function toJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
