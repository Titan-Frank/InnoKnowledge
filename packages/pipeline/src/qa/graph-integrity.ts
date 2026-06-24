import { HIERARCHICAL_EDGE_TYPES, VALID_EDGE_TYPES } from "../shared/knowledge.js";

export type GraphNodeRow = {
  id: string;
  name: string;
  kind: string;
  status?: string | null;
};

export type GraphEdgeRow = {
  id: string;
  type: string;
  from_id: string;
  to_id: string;
  status?: string | null;
};

export type GraphCycleIssue = {
  nodes: string[];
};

export type IsolatedNodeIssue = {
  id: string;
  name: string;
  kind: string;
};

export type WeaklyConnectedIssue = {
  size: number;
  sample_nodes: string[];
};

export type GraphIntegrityIssues = {
  cycles: GraphCycleIssue[];
  directed_cycle_warnings: GraphCycleIssue[];
  isolated_nodes: IsolatedNodeIssue[];
  weakly_connected: WeaklyConnectedIssue[];
};

export type GraphIntegrityResult = {
  status: "success" | "blocked";
  cycles: number;
  directed_cycle_warnings: number;
  isolated_nodes: number;
  disconnected_components: number;
  issues: GraphIntegrityIssues;
};

const WARN_ONLY_DIRECTED_EDGE_TYPES = new Set([...VALID_EDGE_TYPES].filter((type) => type !== "related_to" && type !== "same_as"));

export function checkGraphIntegrity(nodes: GraphNodeRow[], edges: GraphEdgeRow[], options: { failOnCycles?: boolean } = {}): GraphIntegrityResult {
  const activeNodes = nodes.filter((node) => node.status !== "deprecated");
  const activeEdges = edges.filter((edge) => edge.status !== "deprecated");
  const cycles = findCyclesForTypes(activeEdges, HIERARCHICAL_EDGE_TYPES);
  const hardCycleKeys = new Set(cycles.map((cycle) => cycle.nodes.join("\u0000")));
  const directedCycleWarnings = findCyclesForTypes(activeEdges, WARN_ONLY_DIRECTED_EDGE_TYPES).filter((cycle) => !hardCycleKeys.has(cycle.nodes.join("\u0000")));
  const isolatedNodes = findIsolatedNodes(activeNodes, activeEdges);
  const weaklyConnected = findWeaklyConnectedIssues(activeEdges);

  return {
    status: options.failOnCycles && cycles.length > 0 ? "blocked" : "success",
    cycles: cycles.length,
    directed_cycle_warnings: directedCycleWarnings.length,
    isolated_nodes: isolatedNodes.length,
    disconnected_components: weaklyConnected.length,
    issues: {
      cycles,
      directed_cycle_warnings: directedCycleWarnings,
      isolated_nodes: isolatedNodes,
      weakly_connected: weaklyConnected,
    },
  };
}

export function findCyclesForTypes(edges: GraphEdgeRow[], edgeTypes: ReadonlySet<string>): GraphCycleIssue[] {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edgeTypes.has(edge.type)) continue;
    const targets = graph.get(edge.from_id) ?? [];
    targets.push(edge.to_id);
    graph.set(edge.from_id, targets);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const cycles: GraphCycleIssue[] = [];

  function dfs(node: string): void {
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (stack.has(neighbor)) {
        const start = path.indexOf(neighbor);
        cycles.push({ nodes: [...path.slice(start), neighbor] });
      }
    }
    path.pop();
    stack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
  }
  return cycles;
}

function findIsolatedNodes(nodes: GraphNodeRow[], edges: GraphEdgeRow[]): IsolatedNodeIssue[] {
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.from_id);
    connected.add(edge.to_id);
  }
  return nodes.filter((node) => !connected.has(node.id)).map((node) => ({ id: node.id, name: node.name, kind: node.kind }));
}

function findWeaklyConnectedIssues(edges: GraphEdgeRow[]): WeaklyConnectedIssue[] {
  const graph = new Map<string, Set<string>>();
  const allNodes = new Set<string>();
  for (const edge of edges) {
    addUndirectedEdge(graph, edge.from_id, edge.to_id);
    allNodes.add(edge.from_id);
    allNodes.add(edge.to_id);
  }

  const visited = new Set<string>();
  const components: Set<string>[] = [];
  for (const start of allNodes) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component = new Set<string>();
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.add(node);
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  const large = components.filter((component) => component.size > 5);
  return large.length > 1 ? large.map((component) => ({ size: component.size, sample_nodes: [...component].slice(0, 3) })) : [];
}

function addUndirectedEdge(graph: Map<string, Set<string>>, left: string, right: string): void {
  const leftTargets = graph.get(left) ?? new Set<string>();
  leftTargets.add(right);
  graph.set(left, leftTargets);
  const rightTargets = graph.get(right) ?? new Set<string>();
  rightTargets.add(left);
  graph.set(right, rightTargets);
}
