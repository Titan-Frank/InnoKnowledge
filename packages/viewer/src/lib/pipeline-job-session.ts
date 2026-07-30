import type { PipelineStartResponse } from '@okm/types';

const STORAGE_KEY_PREFIX = 'okm:pipeline-job:';

export type PipelineJobStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredPipelineJob = {
  job_id: string;
  log_path: string;
};

function storageKey(sourceKey: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(sourceKey)}`;
}

export function rememberPipelineJob(
  storage: PipelineJobStorage,
  sourceKey: string,
  result: PipelineStartResponse,
): void {
  const stored: StoredPipelineJob = {
    job_id: result.job_id,
    log_path: result.log_path,
  };
  try {
    storage.setItem(storageKey(sourceKey), JSON.stringify(stored));
  } catch {
    // Job tracking must not make an already-started backend job look like a failed start.
  }
}

export function restorePipelineJob(
  storage: PipelineJobStorage,
  sourceKey: string,
): PipelineStartResponse | null {
  const key = storageKey(sourceKey);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPipelineJob>;
    if (typeof parsed.job_id !== 'string' || !parsed.job_id.trim()) {
      forgetPipelineJob(storage, sourceKey);
      return null;
    }
    return {
      job_id: parsed.job_id,
      status: 'started',
      command: [],
      log_path: typeof parsed.log_path === 'string' ? parsed.log_path : '',
    };
  } catch {
    forgetPipelineJob(storage, sourceKey);
    return null;
  }
}

export function forgetPipelineJob(storage: PipelineJobStorage, sourceKey: string): void {
  try {
    storage.removeItem(storageKey(sourceKey));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
