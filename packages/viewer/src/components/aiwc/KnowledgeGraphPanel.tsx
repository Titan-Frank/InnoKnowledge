import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
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
import { resolveEdgeVisual, resolveNodeLayerVisual } from "../../graph/graphPresentation.js";

export type KnowledgeNode = {
  id: string;
  label: string;
  category: string;
  nodeLayer?: string;
  description?: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
};

export type KnowledgeEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  edgeType?: string;
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

const knowledgeNodeWidth = 188;
const knowledgeNodeHeight = 96;
const knowledgeLayerXGap = 272;
const knowledgeLayerYGap = 136;
const knowledgeCollisionPadding = 42;
const knowledgeLayoutPadding = 96;
const knowledgeRelaxationLimit = 32;
const knowledgeGraphNodeTypes = {
  knowledge: KnowledgeFlowNodeCard
};

function KnowledgeFlowNodeCard({ data }: NodeProps<KnowledgeFlowCanvasNode>) {
  const { node, isActive, isInteractive, categoryColor, showLabel } = data;
  const shortLabel = showLabel ? node.label : compactLabel(node.label);
  const layerVisual = resolveNodeLayerVisual(node.nodeLayer);
  const isSupport = node.nodeLayer === "support";

  return (
    <div
      title={node.label}
      style={{
        background: isSupport ? layerVisual.fill : "rgba(255, 255, 255, 0.98)",
        border: `1px ${isSupport ? "dashed" : "solid"} ${isActive ? categoryColor : layerVisual.stroke}`,
        borderRadius: 18,
        boxSizing: "border-box",
        boxShadow: isActive
          ? `0 16px 36px ${hexToRgba(categoryColor, 0.22)}`
          : isSupport
            ? "0 8px 18px rgba(10, 10, 40, 0.04)"
            : "0 10px 24px rgba(10, 10, 40, 0.08)",
        cursor: isInteractive ? "pointer" : "default",
        display: "grid",
        gap: 10,
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
        padding: "12px 14px",
        position: "relative",
        width: "100%"
      }}
    >
      <div
        style={{
          background: `linear-gradient(90deg, ${categoryColor} 0%, ${hexToRgba(categoryColor, 0.22)} 100%)`,
          height: 4,
          inset: "0 0 auto 0",
          position: "absolute"
        }}
      />
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

      <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" }}>
        <span
          style={{
            background: isSupport ? "rgba(255,255,255,0.78)" : (isActive ? hexToRgba(categoryColor, 0.16) : hexToRgba(categoryColor, 0.12)),
            border: `1px solid ${hexToRgba(categoryColor, 0.24)}`,
            borderRadius: aiWebComponentTokens.radiusPill,
            color: categoryColor,
            fontSize: 11,
            fontWeight: 700,
            maxWidth: 108,
            overflow: "hidden",
            padding: "4px 9px",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {node.badge ?? node.category}
        </span>
        <span
          style={{
            background: isSupport ? "rgba(10,10,40,0.06)" : hexToRgba(layerVisual.stroke, 0.12),
            border: `1px solid ${hexToRgba(layerVisual.stroke, 0.16)}`,
            borderRadius: aiWebComponentTokens.radiusPill,
            color: isSupport ? aiWebComponentTokens.colorTextSubtle : layerVisual.stroke,
            fontSize: 10,
            fontWeight: 700,
            padding: "4px 8px",
            whiteSpace: "nowrap"
          }}
        >
          {layerVisual.label}
        </span>
        <span
          aria-hidden="true"
          style={{
            background: categoryColor,
            borderRadius: "50%",
            boxShadow: `0 0 0 6px ${hexToRgba(categoryColor, 0.12)}`,
            display: "inline-block",
            flexShrink: 0,
            height: 8,
            width: 8
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
        <strong
          style={{
            color: aiWebComponentTokens.colorText,
            display: "-webkit-box",
            fontSize: showLabel ? 14 : 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            lineHeight: 1.45,
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: showLabel ? 2 : 1
          }}
        >
          {shortLabel}
        </strong>
        {showLabel ? (
          <span
            style={{
              color: aiWebComponentTokens.colorMuted,
              display: "-webkit-box",
              fontSize: 11,
              lineHeight: 1.45,
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2
            }}
          >
            {node.description ?? "用于承接当前知识图谱中的核心知识关系。"}
          </span>
        ) : null}
      </div>

      <div
        style={{
          alignItems: "center",
          borderTop: `1px solid ${hexToRgba(categoryColor, 0.14)}`,
          color: aiWebComponentTokens.colorTextSubtle,
          display: "flex",
          fontSize: 11,
          fontWeight: 700,
          gap: 8,
          justifyContent: "space-between",
          minHeight: 18,
          paddingTop: 8
        }}
      >
        <span
          style={{
            color: aiWebComponentTokens.colorTextSubtle,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {showLabel ? node.meta ?? "知识节点" : "节点"}
        </span>
        <span style={{ color: categoryColor }}>{isActive ? "焦点" : "图谱"}</span>
      </div>
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
  const { resolvedEdges, unresolvedEdges } = useMemo(() => {
    const nodeIdSet = new Set(nodes.map((node) => node.id));
    const nodeIdByLabel = new Map(nodes.map((node) => [node.label, node.id]));
    const nextResolvedEdges: ResolvedKnowledgeEdge[] = [];
    const nextUnresolvedEdges: KnowledgeEdge[] = [];

    for (const edge of edges) {
      const sourceId = resolveNodeReference(edge.source, nodeIdSet, nodeIdByLabel);
      const targetId = resolveNodeReference(edge.target, nodeIdSet, nodeIdByLabel);

      if (sourceId && targetId) {
        nextResolvedEdges.push({
          ...edge,
          sourceId,
          targetId
        });
        continue;
      }

      nextUnresolvedEdges.push(edge);
    }

    return {
      resolvedEdges: nextResolvedEdges,
      unresolvedEdges: nextUnresolvedEdges
    };
  }, [nodes, edges]);

  const activeNode = useMemo(
    () =>
      nodes.find((node) => node.id === activeNodeId) ??
      nodes.find((node) => node.id === resolvedEdges[0]?.sourceId) ??
      nodes[0],
    [activeNodeId, nodes, resolvedEdges]
  );
  const activeNodeIdResolved = activeNode?.id;
  const layout = useMemo(
    () => createKnowledgeGraphLayout(nodes, resolvedEdges),
    [nodes, resolvedEdges]
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
  const isLargeGraph = nodes.length > knowledgeRelaxationLimit;

  const graphView = (
    <div
      style={graphCanvasShellStyle}
    >
      <div style={graphCanvasOverlayTopStyle}>
        <div style={graphCanvasOverviewCardStyle}>
          <div style={{ alignItems: "center", display: "flex", gap: 10, justifyContent: "space-between" }}>
            <div style={{ display: "grid", gap: 3 }}>
              <div style={{ color: aiWebComponentTokens.colorText, fontSize: 16, fontWeight: 700 }}>
                图谱总览
              </div>
              <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 12, lineHeight: 1.5 }}>
                传统知识图谱视角，支持拖拽、缩放和节点聚焦。
              </div>
            </div>
            <span style={createToneBadgeStyle(isLargeGraph ? "warning" : "accent")}>
              {isLargeGraph ? "大图快速布局" : "精细布局"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span style={createToneBadgeStyle("accent")}>节点 {nodes.length}</span>
            <span style={createToneBadgeStyle("secondary")}>关系 {edges.length}</span>
            <span style={createToneBadgeStyle("neutral")}>类型 {categories}</span>
          </div>
        </div>

        <div style={graphCanvasGuideCardStyle}>
          <span style={createToneBadgeStyle("secondary")}>拖拽节点</span>
          <span style={createToneBadgeStyle("neutral")}>滚轮缩放</span>
          <span style={createToneBadgeStyle(showLabels ? "accent" : "warning")}>
            {showLabels ? "显示名称" : "压缩标签"}
          </span>
        </div>
      </div>

      <div style={graphCanvasViewportStyle}>
        <ReactFlow
          edges={flowEdges}
          elementsSelectable={Boolean(onSelectNode)}
          fitView
          fitViewOptions={{ maxZoom: 1.05, padding: 0.16 }}
          maxZoom={1.35}
          minZoom={0.45}
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
            color="rgba(85, 90, 255, 0.08)"
            gap={32}
            lineWidth={1}
            variant={BackgroundVariant.Lines}
          />
          <MiniMap
            maskColor="rgba(247, 248, 255, 0.72)"
            nodeColor={(node) =>
              (node.data as KnowledgeFlowNodeData | undefined)?.categoryColor ?? aiWebComponentTokens.colorAccent
            }
            pannable
            position="bottom-right"
            style={miniMapStyle}
            zoomable
          />
          <Controls
            showInteractive={false}
            style={graphControlsStyle}
          />
        </ReactFlow>
      </div>

      <div style={graphCanvasOverlayBottomStyle}>
        <div style={graphFocusCardStyle}>
          <div style={{ ...sectionLabelStyle, color: aiWebComponentTokens.colorAccent }}>
            Focus Node
          </div>
          {activeNode ? (
            <>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: aiWebComponentTokens.colorText, fontSize: 17, fontWeight: 700 }}>
                  {activeNode.label}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span style={createToneBadgeStyle("accent")}>{activeNode.badge ?? activeNode.category}</span>
                  <span style={createToneBadgeStyle("neutral")}>{relatedEdges.length} 条相邻关系</span>
                </div>
              </div>
              <div style={{ color: aiWebComponentTokens.colorTextSubtle, fontSize: 13, lineHeight: 1.65 }}>
                {activeNode.description ?? "当前节点用于承接知识概念与跨章节关系。"}
              </div>
            </>
          ) : (
            <div style={{ color: aiWebComponentTokens.colorMuted, fontSize: 13 }}>
              当前还没有可用焦点节点。
            </div>
          )}
        </div>

        {relatedEdges.length > 0 ? (
          <div style={graphRelationsStripStyle}>
            <div style={{ ...sectionLabelStyle, color: aiWebComponentTokens.colorSecondaryAccent }}>
              Key Relations
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {relatedEdges.slice(0, 6).map((edge) => (
                <span
                  key={edge.id}
                  style={graphRelationChipStyle(resolveEdgeVisual(edge.edgeType ?? edge.label).stroke)}
                >
                  {findNodeLabel(nodes, edge.sourceId)} · {edge.label} · {findNodeLabel(nodes, edge.targetId)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
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
          <div style={summaryCardStyle}>
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
            <div style={graphOnlySurfaceStyle}>
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
                style={graphOnlySurfaceStyle}
              >
                <div style={sideCardHeaderStyle}>
                  Graph View
                </div>
                {graphView}
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div style={sideCardStyle}>
                  <div style={sideCardHeaderStyle}>
                    Focus Node
                  </div>
                  <div style={{ display: "grid", gap: 12, padding: "16px 18px 18px" }}>
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

                <div style={sideCardStyle}>
                  <div style={sideCardHeaderStyle}>
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
        height: knowledgeNodeHeight,
        padding: 0,
        width: knowledgeNodeWidth
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
    const edgeVisual = resolveEdgeVisual(edge.edgeType ?? edge.label);

    return {
      animated: isActive,
      id: edge.id,
      label: shouldShowLabel ? edge.label : undefined,
      labelBgBorderRadius: aiWebComponentTokens.radiusPill,
      labelBgPadding: [7, 4],
      labelBgStyle: {
        fill: isActive ? hexToRgba(edgeVisual.stroke, 0.14) : "rgba(255, 255, 255, 0.96)",
        stroke: isActive ? edgeVisual.stroke : hexToRgba(edgeVisual.stroke, 0.2),
        strokeWidth: 1
      },
      labelStyle: {
        fill: isActive ? edgeVisual.stroke : aiWebComponentTokens.colorTextSubtle,
        fontSize: 11,
        fontWeight: 700
      },
      markerEnd: {
        color: isActive ? edgeVisual.stroke : hexToRgba(edgeVisual.stroke, 0.72),
        type: MarkerType.ArrowClosed
      },
      source: edge.sourceId,
      style: {
        stroke: isActive ? edgeVisual.stroke : hexToRgba(edgeVisual.stroke, 0.78),
        strokeDasharray: edgeVisual.dashArray,
        strokeWidth: isActive ? 2.6 : 1.8
      },
      target: edge.targetId,
      type: "smoothstep"
    };
  });
}

function createKnowledgeGraphLayout(
  nodes: KnowledgeNode[],
  edges: ResolvedKnowledgeEdge[]
): Map<string, { x: number; y: number }> {
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));

  if (nodes.length === 0) {
    return new Map();
  }

  const seededPositions = edges.length === 0
    ? createCategorySeedLayout(nodes, nodeOrder)
    : createLayeredSeedLayout(nodes, edges, nodeOrder);

  if (nodes.length > knowledgeRelaxationLimit) {
    return normalizeLayoutPositions(nodes, seededPositions);
  }

  return relaxKnowledgeGraphLayout(nodes, edges, seededPositions);
}

function createCategorySeedLayout(
  nodes: KnowledgeNode[],
  nodeOrder: Map<string, number>
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
      .sort((left, right) => compareNodeOrder(left, right, nodeOrder))
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
  nodeOrder: Map<string, number>
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
    .sort((left, right) => compareNodeOrder(left, right, nodeOrder))
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
      depths.set(node.id, fallbackDepth);
      fallbackDepth += 1;
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
        .sort((left, right) => compareNodeOrder(left, right, nodeOrder))
        .forEach((node, rowIndex) => {
          positions.set(node.id, {
            x: layer * knowledgeLayerXGap,
            y: layerOffset + rowIndex * knowledgeLayerYGap
          });
        });
    });

  return positions;
}

function normalizeLayoutPositions(
  nodes: KnowledgeNode[],
  seededPositions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const current = seededPositions.get(node.id) ?? { x: 0, y: 0 };
    minX = Math.min(minX, current.x);
    minY = Math.min(minY, current.y);
  }

  for (const node of nodes) {
    const current = seededPositions.get(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, {
      x: current.x - minX + knowledgeLayoutPadding,
      y: current.y - minY + knowledgeLayoutPadding
    });
  }

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

  const iterations = Math.min(170, Math.max(96, nodes.length * 4));
  const spring = 0.016;
  const repulsion = Math.max(9000, nodes.length * 380);
  const centering = 0.012;
  const damping = 0.84;
  const collisionDistance = Math.max(knowledgeNodeWidth, knowledgeNodeHeight) + knowledgeCollisionPadding;
  const idealLength = knowledgeLayerXGap * 0.7;

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
          const overlap = ((collisionDistance - dist) / collisionDistance) * 10;
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
      current.vy += (current.anchorY - current.y) * (centering * 0.68);
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

function compactLabel(label: string) {
  return label.length > 8 ? `${label.slice(0, 8)}…` : label;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((item) => `${item}${item}`).join("")
    : normalized;

  if (safe.length !== 6) {
    return `rgba(85, 90, 255, ${alpha})`;
  }

  const red = Number.parseInt(safe.slice(0, 2), 16);
  const green = Number.parseInt(safe.slice(2, 4), 16);
  const blue = Number.parseInt(safe.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function compareNodeOrder(
  left: KnowledgeNode,
  right: KnowledgeNode,
  nodeOrder: Map<string, number>
) {
  return (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0);
}

const hiddenHandleStyle = {
  background: "transparent",
  border: "none",
  height: 10,
  opacity: 0,
  width: 10
} satisfies CSSProperties;

const summaryCardStyle = {
  background: "rgba(255, 255, 255, 0.94)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderLeft: `3px solid ${aiWebComponentTokens.colorAccent}`,
  borderRadius: 16,
  lineHeight: 1.65,
  padding: "16px 18px"
} satisfies CSSProperties;

const graphOnlySurfaceStyle = {
  background: aiWebComponentTokens.colorSurface,
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 20,
  overflow: "hidden",
  position: "relative"
} satisfies CSSProperties;

const graphCanvasShellStyle = {
  background: "linear-gradient(180deg, rgba(247, 248, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%)",
  height: "clamp(560px, 76vh, 860px)",
  minHeight: 520,
  overflow: "hidden",
  position: "relative"
} satisfies CSSProperties;

const graphCanvasViewportStyle = {
  inset: 0,
  position: "absolute"
} satisfies CSSProperties;

const graphCanvasOverlayTopStyle = {
  alignItems: "start",
  display: "flex",
  gap: 12,
  justifyContent: "space-between",
  left: 16,
  pointerEvents: "none",
  position: "absolute",
  right: 16,
  top: 16,
  zIndex: 5
} satisfies CSSProperties;

const graphCanvasOverviewCardStyle = {
  backdropFilter: "blur(10px)",
  background: "rgba(255, 255, 255, 0.88)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 20,
  boxShadow: aiWebComponentTokens.shadowSoft,
  display: "grid",
  gap: 10,
  maxWidth: 360,
  padding: "14px 16px",
  pointerEvents: "auto"
} satisfies CSSProperties;

const graphCanvasGuideCardStyle = {
  alignItems: "center",
  backdropFilter: "blur(10px)",
  background: "rgba(255, 255, 255, 0.84)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusPill,
  boxShadow: aiWebComponentTokens.shadowSoft,
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  justifyContent: "flex-end",
  padding: "10px 12px",
  pointerEvents: "auto"
} satisfies CSSProperties;

const graphCanvasOverlayBottomStyle = {
  bottom: 16,
  display: "grid",
  gap: 12,
  left: 16,
  maxWidth: 560,
  pointerEvents: "none",
  position: "absolute",
  zIndex: 5
} satisfies CSSProperties;

const graphFocusCardStyle = {
  backdropFilter: "blur(10px)",
  background: "rgba(255, 255, 255, 0.9)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 20,
  boxShadow: aiWebComponentTokens.shadowSoft,
  display: "grid",
  gap: 10,
  padding: "14px 16px",
  pointerEvents: "auto"
} satisfies CSSProperties;

const graphRelationsStripStyle = {
  backdropFilter: "blur(10px)",
  background: "rgba(255, 255, 255, 0.84)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 18,
  boxShadow: aiWebComponentTokens.shadowSoft,
  display: "grid",
  gap: 10,
  padding: "12px 14px",
  pointerEvents: "auto"
} satisfies CSSProperties;

function graphRelationChipStyle(stroke: string): CSSProperties {
  return {
    background: hexToRgba(stroke, 0.1),
    border: `1px solid ${hexToRgba(stroke, 0.18)}`,
    borderRadius: aiWebComponentTokens.radiusPill,
    color: aiWebComponentTokens.colorTextSubtle,
    display: "inline-flex",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.45,
    padding: "6px 10px"
  };
}

const miniMapStyle = {
  background: "rgba(255, 255, 255, 0.92)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 16,
  boxShadow: aiWebComponentTokens.shadowSoft
} satisfies CSSProperties;

const graphControlsStyle = {
  background: "rgba(255, 255, 255, 0.94)",
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 14,
  boxShadow: aiWebComponentTokens.shadowSoft
} satisfies CSSProperties;

const sideCardStyle = {
  background: aiWebComponentTokens.colorSurface,
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: 18,
  display: "grid",
  overflow: "hidden"
} satisfies CSSProperties;

const sideCardHeaderStyle = {
  ...sectionLabelStyle,
  borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
  color: aiWebComponentTokens.colorMuted,
  padding: "12px 16px"
} satisfies CSSProperties;
