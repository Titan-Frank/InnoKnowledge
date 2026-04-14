import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PanelStateBlock } from "./shared/PanelStateBlock";
import {
  createIconFrameStyle,
  createToneBadgeStyle,
  panelBodyStyle,
  panelHeaderMainStyle,
  panelHeaderStyle,
  panelSubtitleStyle,
  panelSurfaceStyle,
  panelTitleRowStyle,
  panelTitleStyle,
  sectionLabelStyle
} from "./styles/panelStyles";
import { aiWebComponentTokens } from "./styles/tokens";
import { TYPE_META } from "../../constants/index.js";

export type KnowledgeNode = {
  id: string;
  label: string;
  category: string;
  description?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
};

export type KnowledgeEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  description?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
};

export type KnowledgeGraphPanelProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  titleIcon?: ReactNode;
  hideHeader?: boolean;
  hideSidebar?: boolean;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  draggedPositions?: Map<string, { x: number; y: number }>;
  status?: "idle" | "loading" | "error";
  emptyState?: ReactNode;
  loadingState?: ReactNode;
  errorState?: ReactNode;
  emptyVisual?: ReactNode;
  emptyAction?: ReactNode;
  loadingVisual?: ReactNode;
  loadingAction?: ReactNode;
  errorVisual?: ReactNode;
  errorAction?: ReactNode;
  summary?: ReactNode;
  headerActions?: ReactNode;
  activeNodeId?: string;
  showLabels?: boolean;
  onSelectNode?: (node: KnowledgeNode) => void;
  onNodeDragStop?: (nodeId: string, position: { x: number; y: number }) => void;
};

type ResolvedKnowledgeEdge = KnowledgeEdge & {
  sourceId: string;
  targetId: string;
};

type KnowledgeFlowNodeData = {
  node: KnowledgeNode;
  isActive: boolean;
  isInteractive: boolean;
  categoryColor: string;
  showLabel: boolean;
};

type KnowledgeFlowCanvasNode = FlowNode<KnowledgeFlowNodeData, "knowledge">;
type KnowledgeFlowCanvasEdge = FlowEdge<{ isActive: boolean }, "smoothstep">;

const knowledgeNodeSize = 88;
const knowledgeLayerXGap = 280;
const knowledgeLayerYGap = 124;
const knowledgeCollisionPadding = 34;
const knowledgeLayoutPadding = 80;
const knowledgeGraphNodeTypes = {
  knowledge: KnowledgeFlowNodeCard
};

function KnowledgeFlowNodeCard({ data }: NodeProps<KnowledgeFlowCanvasNode>) {
  const { node, isActive, isInteractive, categoryColor, showLabel } = data;

  return (
    <div
      title={node.label}
      style={{
        alignItems: "center",
        background: isActive ? aiWebComponentTokens.colorAccentSoft : `${categoryColor}18`,
        border: `2px solid ${isActive ? aiWebComponentTokens.colorAccent : categoryColor}`,
        borderRadius: "50%",
        boxSizing: "border-box",
        boxShadow: isActive ? aiWebComponentTokens.shadowSoft : "none",
        cursor: isInteractive ? "pointer" : "default",
        color: isActive ? aiWebComponentTokens.colorAccentStrong : categoryColor,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: 8,
        textAlign: "center",
        width: "100%"
      }}
    >
      <Handle
        isConnectable={false}
        position={Position.Left}
        style={hiddenHandleStyle}
        type="target"
      />
      <Handle
        isConnectable={false}
        position={Position.Right}
        style={hiddenHandleStyle}
        type="source"
      />

      <strong
        style={{
          color: isActive ? aiWebComponentTokens.colorAccentStrong : aiWebComponentTokens.colorText,
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1.3,
          maxWidth: 54,
          opacity: showLabel ? 1 : 0,
          transform: showLabel ? "scale(1)" : "scale(0.92)",
          transition: "opacity 120ms ease, transform 120ms ease"
        }}
      >
        {showLabel ? node.label : "\u00A0"}
      </strong>
    </div>
  );
}

export function KnowledgeGraphPanel({
  title = "知识图谱",
  subtitle,
  titleIcon,
  hideHeader = false,
  hideSidebar = false,
  nodes,
  edges,
  draggedPositions,
  status = "idle",
  emptyState,
  loadingState,
  errorState,
  emptyVisual,
  emptyAction,
  loadingVisual,
  loadingAction,
  errorVisual,
  errorAction,
  summary,
  headerActions,
  activeNodeId,
  showLabels = true,
  onSelectNode,
  onNodeDragStop
}: KnowledgeGraphPanelProps) {
  const showError = status === "error";
  const showEmpty = nodes.length === 0 && edges.length === 0 && status === "idle";
  const showLoading = nodes.length === 0 && edges.length === 0 && status === "loading";
  const categories = new Set(nodes.map((node) => node.category)).size;
  const surfaceStyle = hideHeader
    ? { ...panelSurfaceStyle, background: "transparent", border: "none", borderRadius: 0 }
    : panelSurfaceStyle;
  const bodyStyle = hideHeader ? { ...panelBodyStyle, gap: 10, padding: 0 } : panelBodyStyle;
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const nodeIdByLabel = new Map(nodes.map((node) => [node.label, node.id]));
  const resolvedEdges: ResolvedKnowledgeEdge[] = [];
  const unresolvedEdges: KnowledgeEdge[] = [];

  for (const edge of edges) {
    const sourceId = resolveNodeReference(edge.source, nodeIdSet, nodeIdByLabel);
    const targetId = resolveNodeReference(edge.target, nodeIdSet, nodeIdByLabel);

    if (sourceId && targetId) {
      resolvedEdges.push({
        ...edge,
        sourceId,
        targetId
      });
      continue;
    }

    unresolvedEdges.push(edge);
  }

  const activeNode = useMemo(
    () =>
      nodes.find((node) => node.id === activeNodeId) ??
      nodes.find((node) => node.id === resolvedEdges[0]?.sourceId) ??
      nodes[0],
    [activeNodeId, nodes, resolvedEdges]
  );
  const activeNodeIdResolved = activeNode?.id;
  const layout = useMemo(
    () => createKnowledgeGraphLayout(nodes, resolvedEdges, activeNodeIdResolved),
    [nodes, resolvedEdges, activeNodeIdResolved]
  );
  const flowNodes = useMemo(
    () =>
      buildFlowNodes(
        nodes,
        activeNodeIdResolved,
        Boolean(onSelectNode),
        showLabels,
        layout,
        draggedPositions
      ),
    [nodes, activeNodeIdResolved, onSelectNode, showLabels, layout, draggedPositions]
  );
  const flowEdges = useMemo(
    () => buildFlowEdges(resolvedEdges, activeNodeIdResolved, showLabels),
    [resolvedEdges, activeNodeIdResolved, showLabels]
  );
  const relatedEdges = activeNodeIdResolved
    ? resolvedEdges.filter(
        (edge) => edge.sourceId === activeNodeIdResolved || edge.targetId === activeNodeIdResolved
      )
    : resolvedEdges;

  const graphView = (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(244, 246, 255, 0.88) 0%, rgba(255, 255, 255, 0.98) 100%)",
        height: hideSidebar ? "clamp(520px, 74vh, 820px)" : 440,
        minHeight: 480
      }}
    >
      <ReactFlow
        edges={flowEdges}
        elementsSelectable={Boolean(onSelectNode)}
        fitView
        fitViewOptions={{ maxZoom: 1.08, padding: 0.18 }}
        maxZoom={1.3}
        minZoom={0.55}
        nodeTypes={knowledgeGraphNodeTypes}
        nodes={flowNodes}
        nodesConnectable={false}
        nodesDraggable={true}
        onlyRenderVisibleElements
        onNodeClick={(_, node) => {
          onSelectNode?.(node.data.node);
        }}
        onNodeDragStop={(_, node) => {
          onNodeDragStop?.(node.id, node.position);
        }}
        panOnDrag
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={aiWebComponentTokens.colorBorder}
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          showInteractive={false}
          style={{
            background: aiWebComponentTokens.colorSurface,
            border: `1px solid ${aiWebComponentTokens.colorBorder}`,
            borderRadius: 12,
            boxShadow: aiWebComponentTokens.shadowSoft
          }}
        />
      </ReactFlow>
    </div>
  );

  return (
    <section style={surfaceStyle}>
      {!hideHeader ? (
        <header style={panelHeaderStyle}>
          <div style={panelHeaderMainStyle}>
            <div style={panelTitleRowStyle}>
              {titleIcon ? <span style={createIconFrameStyle("accent")}>{titleIcon}</span> : null}
              <div style={panelTitleStyle}>{title}</div>
            </div>
            <div style={panelSubtitleStyle}>
              {subtitle ?? "用于承接知识点、任务链路与文件引用之间的结构化关系。"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={createToneBadgeStyle("accent")}>{nodes.length} 个节点</span>
              <span style={createToneBadgeStyle("secondary")}>{edges.length} 条关系</span>
              <span style={createToneBadgeStyle("neutral")}>{categories} 个分组</span>
            </div>
          </div>
          {headerActions ? <div>{headerActions}</div> : null}
        </header>
      ) : null}

      <div style={bodyStyle}>
        {summary ? (
          <div
            style={{
              background: aiWebComponentTokens.colorSurface,
              border: `1px solid ${aiWebComponentTokens.colorBorder}`,
              borderLeft: `3px solid ${aiWebComponentTokens.colorAccent}`,
              borderRadius: 8,
              lineHeight: 1.6,
              padding: "14px 16px"
            }}
          >
            {summary}
          </div>
        ) : null}

        {showError ? (
          <PanelStateBlock
            action={errorAction}
            description={errorState ?? "图谱数据加载失败。"}
            title="暂时无法整理知识关系"
            tone="danger"
            visual={errorVisual}
          />
        ) : null}
        {showLoading ? (
          <PanelStateBlock
            action={loadingAction}
            description={loadingState ?? "正在整理知识关系..."}
            title="正在生成关系视图"
            tone="accent"
            visual={loadingVisual}
          />
        ) : null}
        {showEmpty ? (
          <PanelStateBlock
            action={emptyAction}
            description={emptyState ?? "当前还没有可展示的知识关系。"}
            title="还没有图谱内容"
            tone="neutral"
            visual={emptyVisual}
          />
        ) : null}

        {!showError && !showLoading && !showEmpty ? (
          hideSidebar ? (
            <div
              style={{
                background: aiWebComponentTokens.colorSurface,
                border: `1px solid ${aiWebComponentTokens.colorBorder}`,
                borderRadius: 8,
                overflow: "hidden"
              }}
            >
              {graphView}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 0.95fr)"
              }}
            >
              <div
                style={{
                  background: aiWebComponentTokens.colorSurface,
                  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
                  borderRadius: 8,
                  display: "grid",
                  overflow: "hidden"
                }}
              >
                <div
                  style={{
                    ...sectionLabelStyle,
                    borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
                    padding: "10px 12px"
                  }}
                >
                  Graph View
                </div>
                {graphView}
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div
                  style={{
                    background: aiWebComponentTokens.colorSurface,
                    border: `1px solid ${aiWebComponentTokens.colorBorder}`,
                    borderRadius: 8,
                    display: "grid",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      ...sectionLabelStyle,
                      borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
                      padding: "10px 12px"
                    }}
                  >
                    Focus Node
                  </div>
                  <div style={{ display: "grid", gap: 12, padding: "14px 14px 16px" }}>
                    {activeNode ? (
                      <>
                        <div style={{ alignItems: "center", display: "flex", gap: 10, justifyContent: "space-between" }}>
                          <strong style={{ color: aiWebComponentTokens.colorText }}>{activeNode.label}</strong>
                          {activeNode.badge ? (
                            <span style={createToneBadgeStyle("accent")}>{activeNode.badge}</span>
                          ) : null}
                        </div>
                        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <span style={createToneBadgeStyle("secondary")}>{activeNode.category}</span>
                          <span style={createToneBadgeStyle("neutral")}>{relatedEdges.length} 条相邻关系</span>
                        </div>
                        <div style={{ color: aiWebComponentTokens.colorTextSubtle, fontSize: 13, lineHeight: 1.65 }}>
                          {activeNode.description ?? "该节点用于承接当前图谱中的一类核心知识信息。"}
                        </div>
                        {activeNode.meta ? (
                          <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 12 }}>{activeNode.meta}</div>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 13, lineHeight: 1.6 }}>
                        当前没有可展示的焦点节点。
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    background: aiWebComponentTokens.colorSurface,
                    border: `1px solid ${aiWebComponentTokens.colorBorder}`,
                    borderRadius: 8,
                    display: "grid",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      ...sectionLabelStyle,
                      borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
                      padding: "10px 12px"
                    }}
                  >
                    Relations
                  </div>
                  <div style={{ display: "grid" }}>
                    {(relatedEdges.length > 0 ? relatedEdges : resolvedEdges).map((edge, index) => (
                      <div
                        key={edge.id}
                        style={{
                          background: aiWebComponentTokens.colorSurface,
                          borderTop: index === 0 ? "none" : `1px solid ${aiWebComponentTokens.colorBorder}`,
                          display: "grid",
                          gap: 6,
                          padding: "12px 14px"
                        }}
                      >
                        <div
                          style={{
                            alignItems: "center",
                            display: "flex",
                            gap: 8,
                            justifyContent: "space-between"
                          }}
                        >
                          <strong style={{ color: aiWebComponentTokens.colorText }}>{edge.label}</strong>
                          {edge.badge ? <span style={createToneBadgeStyle("secondary")}>{edge.badge}</span> : null}
                        </div>
                        <div style={{ color: aiWebComponentTokens.colorTextSubtle, fontSize: 13 }}>
                          {edge.description ?? `${findNodeLabel(nodes, edge.sourceId)} → ${findNodeLabel(nodes, edge.targetId)}`}
                        </div>
                        <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 12 }}>
                          {findNodeLabel(nodes, edge.sourceId)} → {findNodeLabel(nodes, edge.targetId)}
                        </div>
                        {edge.meta ? (
                          <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 12 }}>{edge.meta}</div>
                        ) : null}
                      </div>
                    ))}
                    {resolvedEdges.length === 0 ? (
                      <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 13, padding: "14px 14px 16px" }}>
                        当前还没有可解析的节点关系。
                      </div>
                    ) : null}
                  </div>
                </div>

                {unresolvedEdges.length > 0 ? (
                  <div
                    style={{
                      background: aiWebComponentTokens.colorWarningSoft,
                      border: `1px solid #f7de95`,
                      borderRadius: 8,
                      color: aiWebComponentTokens.colorTextSubtle,
                      fontSize: 12,
                      lineHeight: 1.6,
                      padding: "12px 14px"
                    }}
                  >
                    有 {unresolvedEdges.length} 条关系没有匹配到节点 id，图中已自动忽略，但仍建议将
                    `edge.source / edge.target` 统一对齐到 `node.id`。
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

function buildFlowNodes(
  nodes: KnowledgeNode[],
  activeNodeId: string | undefined,
  interactive: boolean,
  showLabels: boolean,
  layout: Map<string, { x: number; y: number }>,
  draggedPositions?: Map<string, { x: number; y: number }>
): KnowledgeFlowCanvasNode[] {
  return nodes.map((node) => {
    const categoryColor = TYPE_META[node.category]?.color ?? TYPE_META.other.color;
    const position = draggedPositions?.get(node.id) ?? layout.get(node.id) ?? { x: 0, y: 0 };

    return {
      id: node.id,
      data: {
        node,
        isActive: node.id === activeNodeId,
        isInteractive: interactive,
        categoryColor,
        showLabel: showLabels
      },
      position,
      style: {
        background: "transparent",
        border: "none",
        height: knowledgeNodeSize,
        padding: 0,
        width: knowledgeNodeSize
      },
      type: "knowledge"
    };
  });
}

function buildFlowEdges(
  edges: ResolvedKnowledgeEdge[],
  activeNodeId: string | undefined,
  showLabels: boolean
): KnowledgeFlowCanvasEdge[] {
  return edges.map((edge) => {
    const isActive = activeNodeId
      ? edge.sourceId === activeNodeId || edge.targetId === activeNodeId
      : false;
    const shouldShowLabel = showLabels && (edges.length <= 18 || isActive);

    return {
      animated: isActive,
      id: edge.id,
      label: shouldShowLabel ? edge.label : undefined,
      labelBgBorderRadius: 8,
      labelBgPadding: [6, 4],
      labelBgStyle: {
        fill: isActive ? aiWebComponentTokens.colorAccentSoft : aiWebComponentTokens.colorSurface
      },
      labelStyle: {
        fill: isActive ? aiWebComponentTokens.colorAccentStrong : aiWebComponentTokens.colorTextSubtle,
        fontSize: 11,
        fontWeight: 700
      },
      markerEnd: {
        color: isActive ? aiWebComponentTokens.colorAccent : aiWebComponentTokens.colorBorderStrong,
        type: MarkerType.ArrowClosed
      },
      source: edge.sourceId,
      style: {
        stroke: isActive ? aiWebComponentTokens.colorAccent : aiWebComponentTokens.colorBorderStrong,
        strokeWidth: isActive ? 2.2 : 1.6
      },
      target: edge.targetId,
      type: "smoothstep"
    };
  });
}

function createKnowledgeGraphLayout(
  nodes: KnowledgeNode[],
  edges: ResolvedKnowledgeEdge[],
  activeNodeId: string | undefined
): Map<string, { x: number; y: number }> {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));

  if (nodes.length === 0) {
    return new Map();
  }

  const seededPositions = edges.length === 0
    ? createCategorySeedLayout(nodes, nodeOrder, activeNodeId)
    : createLayeredSeedLayout(nodes, edges, nodeOrder, activeNodeId);

  return relaxKnowledgeGraphLayout(nodes, edges, seededPositions);
}

function createCategorySeedLayout(
  nodes: KnowledgeNode[],
  nodeOrder: Map<string, number>,
  activeNodeId: string | undefined
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodesByCategory = new Map<string, KnowledgeNode[]>();

  for (const node of nodes) {
    const categoryNodes = nodesByCategory.get(node.category) ?? [];
    categoryNodes.push(node);
    nodesByCategory.set(node.category, categoryNodes);
  }

  Array.from(nodesByCategory.entries()).forEach(([_, categoryNodes], columnIndex) => {
    const categoryOffset = getCenteredColumnOffset(categoryNodes.length);
    categoryNodes
      .slice()
      .sort((left, right) => compareNodeOrder(left, right, nodeOrder, activeNodeId))
      .forEach((node, rowIndex) => {
        positions.set(node.id, {
          x: columnIndex * knowledgeLayerXGap,
          y: categoryOffset + rowIndex * knowledgeLayerYGap
        });
      });
  });

  return positions;
}

function createLayeredSeedLayout(
  nodes: KnowledgeNode[],
  edges: ResolvedKnowledgeEdge[],
  nodeOrder: Map<string, number>,
  activeNodeId: string | undefined
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceId)?.push(edge.targetId);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => compareNodeOrder(left, right, nodeOrder, activeNodeId))
    .map((node) => node.id);
  const depths = new Map<string, number>(queue.map((nodeId) => [nodeId, 0]));

  while (queue.length > 0) {
    const currentNodeId = queue.shift();

    if (!currentNodeId) {
      continue;
    }

    const nextDepth = (depths.get(currentNodeId) ?? 0) + 1;

    for (const targetNodeId of adjacency.get(currentNodeId) ?? []) {
      depths.set(targetNodeId, Math.max(depths.get(targetNodeId) ?? 0, nextDepth));
      indegree.set(targetNodeId, (indegree.get(targetNodeId) ?? 1) - 1);

      if ((indegree.get(targetNodeId) ?? 0) === 0) {
        queue.push(targetNodeId);
      }
    }
  }

  let fallbackDepth = depths.size > 0 ? Math.max(...depths.values()) + 1 : 0;

  for (const node of nodes) {
    if (!depths.has(node.id)) {
      depths.set(node.id, node.id === activeNodeId ? 0 : fallbackDepth);
      fallbackDepth += node.id === activeNodeId ? 0 : 1;
    }
  }

  const layers = new Map<number, KnowledgeNode[]>();

  for (const node of nodes) {
    const layer = depths.get(node.id) ?? 0;
    const layerNodes = layers.get(layer) ?? [];
    layerNodes.push(node);
    layers.set(layer, layerNodes);
  }

  Array.from(layers.entries())
    .sort(([leftLayer], [rightLayer]) => leftLayer - rightLayer)
    .forEach(([layer, layerNodes]) => {
      const layerOffset = getCenteredColumnOffset(layerNodes.length);
      layerNodes
        .slice()
        .sort((left, right) => compareNodeOrder(left, right, nodeOrder, activeNodeId))
        .forEach((node, rowIndex) => {
          positions.set(node.id, {
            x: layer * knowledgeLayerXGap,
            y: layerOffset + rowIndex * knowledgeLayerYGap
          });
        });
    });

  return positions;
}

function relaxKnowledgeGraphLayout(
  nodes: KnowledgeNode[],
  edges: ResolvedKnowledgeEdge[],
  seededPositions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const state = new Map<
    string,
    { x: number; y: number; vx: number; vy: number; anchorX: number; anchorY: number }
  >();

  nodes.forEach((node, index) => {
    const seeded = seededPositions.get(node.id) ?? {
      x: (index % 4) * knowledgeLayerXGap,
      y: Math.floor(index / 4) * knowledgeLayerYGap
    };

    state.set(node.id, {
      x: seeded.x,
      y: seeded.y,
      vx: 0,
      vy: 0,
      anchorX: seeded.x,
      anchorY: seeded.y
    });
  });

  const iterations = Math.min(260, Math.max(150, nodes.length * 6));
  const spring = 0.018;
  const repulsion = Math.max(14000, nodes.length * 520);
  const centering = 0.012;
  const damping = 0.84;
  const collisionDistance = knowledgeNodeSize + knowledgeCollisionPadding;
  const idealLength = knowledgeLayerXGap * 0.72;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;

    for (let i = 0; i < nodes.length; i += 1) {
      const a = state.get(nodes[i].id);
      if (!a) {
        continue;
      }

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = state.get(nodes[j].id);
        if (!b) {
          continue;
        }

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;

        if (distSq < 1) {
          dx = 0.5;
          dy = 0.5;
          distSq = 0.5;
        }

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const force = (repulsion * cooling) / distSq;

        a.vx -= nx * force;
        a.vy -= ny * force;
        b.vx += nx * force;
        b.vy += ny * force;

        if (dist < collisionDistance) {
          const overlap = ((collisionDistance - dist) / collisionDistance) * 12;
          a.vx -= nx * overlap;
          a.vy -= ny * overlap;
          b.vx += nx * overlap;
          b.vy += ny * overlap;
        }
      }
    }

    for (const edge of edges) {
      const source = state.get(edge.sourceId);
      const target = state.get(edge.targetId);

      if (!source || !target) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const nx = dx / dist;
      const ny = dy / dist;
      const delta = dist - idealLength;
      const force = delta * spring;

      source.vx += nx * force;
      source.vy += ny * force;
      target.vx -= nx * force;
      target.vy -= ny * force;
    }

    for (const node of nodes) {
      const current = state.get(node.id);

      if (!current) {
        continue;
      }

      current.vx += (current.anchorX - current.x) * centering;
      current.vy += (current.anchorY - current.y) * (centering * 0.65);
      current.vx *= damping;
      current.vy *= damping;
      current.x += current.vx;
      current.y += current.vy;
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  nodes.forEach((node) => {
    const current = state.get(node.id);

    if (!current) {
      return;
    }

    minX = Math.min(minX, current.x);
    minY = Math.min(minY, current.y);
  });

  nodes.forEach((node) => {
    const current = state.get(node.id);

    if (!current) {
      return;
    }

    positions.set(node.id, {
      x: current.x - minX + knowledgeLayoutPadding,
      y: current.y - minY + knowledgeLayoutPadding
    });
  });

  return positions;
}

function getCenteredColumnOffset(length: number) {
  return -((Math.max(length - 1, 0) * knowledgeLayerYGap) / 2);
}

function resolveNodeReference(
  reference: string,
  nodeIdSet: Set<string>,
  nodeIdByLabel: Map<string, string>
) {
  if (nodeIdSet.has(reference)) {
    return reference;
  }

  return nodeIdByLabel.get(reference);
}

function findNodeLabel(nodes: KnowledgeNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function compareNodeOrder(
  left: KnowledgeNode,
  right: KnowledgeNode,
  nodeOrder: Map<string, number>,
  activeNodeId: string | undefined
) {
  if (left.id === activeNodeId) {
    return -1;
  }

  if (right.id === activeNodeId) {
    return 1;
  }

  return (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0);
}

const hiddenHandleStyle = {
  background: "transparent",
  border: "none",
  height: 10,
  opacity: 0,
  width: 10
} satisfies CSSProperties;
