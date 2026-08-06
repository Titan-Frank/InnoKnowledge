import type { KnowledgeGraph } from '@/core/graph/types';
import type { ApiUnit } from '@okm/types';

const EXPORT_FORMAT = 'okm-knowledge-package';
const EXPORT_FORMAT_VERSION = '2.0';

function exportDateSegment(exportedAt: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(exportedAt);
  return match?.[0] ?? 'export';
}

export function safeExportName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'knowledge-graph';
}

export interface ApiUnitExportResult {
  units: ApiUnit[];
  failedNodeIds: string[];
}

export async function collectApiUnitsForExport(
  nodeIds: string[],
  loader: (nodeId: string) => Promise<ApiUnit | null>,
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<ApiUnitExportResult> {
  const requestedConcurrency = options.concurrency ?? 6;
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(12, Math.floor(requestedConcurrency)))
    : 6;
  const results = new Array<ApiUnit | null>(nodeIds.length).fill(null);
  const failedIndexes = new Set<number>();
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < nodeIds.length) {
      const index = cursor;
      cursor += 1;
      try {
        const unit = await loader(nodeIds[index]);
        if (unit) results[index] = unit;
        else failedIndexes.add(index);
      } catch {
        failedIndexes.add(index);
      } finally {
        completed += 1;
        options.onProgress?.(completed, nodeIds.length);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, nodeIds.length) }, () => worker()),
  );

  return {
    units: results.filter((unit): unit is ApiUnit => unit !== null),
    failedNodeIds: nodeIds.filter((_, index) => failedIndexes.has(index)),
  };
}

export function createKnowledgePackageExport(
  graph: KnowledgeGraph,
  apiUnits: ApiUnit[],
  options: {
    datasetId: string;
    datasetLabel?: string | null;
    exportedAt?: string;
  },
) {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const unitNodeIds = new Set(apiUnits.map((unit) => unit.node.id));
  if (
    apiUnits.length !== graph.nodes.length
    || unitNodeIds.size !== graphNodeIds.size
    || Array.from(graphNodeIds).some((nodeId) => !unitNodeIds.has(nodeId))
  ) {
    throw new Error('Cannot create a full knowledge package without exactly one ApiUnit per graph node.');
  }

  return {
    export_format: EXPORT_FORMAT,
    export_format_version: EXPORT_FORMAT_VERSION,
    exported_at: exportedAt,
    dataset: {
      id: options.datasetId,
      label: options.datasetLabel ?? options.datasetId,
    },
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      books: graph.booksById.size,
      evidence: graph.evidenceById.size,
      api_units: apiUnits.length,
    },
    nodes: graph.nodes.map(({ mentionBookIds, scopeBookIds, ...node }) => ({
      ...node,
      mentionBookIds: Array.from(mentionBookIds).sort(),
      scopeBookIds: Array.from(scopeBookIds).sort(),
    })),
    edges: graph.edges,
    books: Array.from(graph.booksById.values()),
    evidence: Array.from(graph.evidenceById.values()),
    framework: {
      domains: Array.from(graph.frameworkDomains.values()),
      topics: Array.from(graph.frameworkTopics.values()),
    },
    patterns: Array.from(graph.patternsById.values()),
    api_units: apiUnits,
    asset_packaging: 'references-only' as const,
    source: graph.source,
    manifest: graph.manifest,
    load_warnings: graph.loadWarnings,
  };
}

export function createKnowledgePackageExportFilename(datasetId: string, exportedAt: string): string {
  return `okm-full-${safeExportName(datasetId)}-${exportDateSegment(exportedAt)}.json`;
}

export function downloadKnowledgePackageJson(
  graph: KnowledgeGraph,
  apiUnits: ApiUnit[],
  options: { datasetId: string; datasetLabel?: string | null },
): string {
  const exportedAt = new Date().toISOString();
  const payload = createKnowledgePackageExport(graph, apiUnits, { ...options, exportedAt });
  const filename = createKnowledgePackageExportFilename(options.datasetId, exportedAt);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return filename;
}
