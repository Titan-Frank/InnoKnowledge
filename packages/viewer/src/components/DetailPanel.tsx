import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { DetailHeader } from './sections/DetailHeader';
import { DetailDescription } from './sections/DetailDescription';
import { DetailKnowledgeAxes } from './sections/DetailKnowledgeAxes';
import { DetailAliases } from './sections/DetailAliases';
import { DetailProperties } from './sections/DetailProperties';
import { DetailSupportNodes } from './sections/DetailSupportNodes';
import { DetailUnit } from './sections/DetailUnit';
import { DetailMentions } from './sections/DetailMentions';
import { Maximize2, X } from '@/lib/lucide-icons';
import type { OKMNode } from '@/core/graph/types';

const DETAIL_PANEL_WIDTH_KEY = 'okm-detail-panel-width';
const DEFAULT_DETAIL_PANEL_WIDTH = 384;
const MIN_DETAIL_PANEL_WIDTH = 320;
const MAX_DETAIL_PANEL_WIDTH = 760;
const DETAIL_PANEL_EXIT_MS = 280;

function clampPanelWidth(value: number): number {
  const viewportLimit = typeof window === 'undefined' ? MAX_DETAIL_PANEL_WIDTH : Math.floor(window.innerWidth * 0.65);
  return Math.min(Math.max(value, MIN_DETAIL_PANEL_WIDTH), Math.min(MAX_DETAIL_PANEL_WIDTH, viewportLimit));
}

function readPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DETAIL_PANEL_WIDTH;
  const stored = Number(window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY));
  return clampPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DETAIL_PANEL_WIDTH);
}

const NodeDetailBody = memo(function NodeDetailBody({ node, selectedBook }: { node: OKMNode; selectedBook: string }) {
  return (
    <>
      <DetailUnit node={node} />
      {!node.description ? null : <DetailDescription node={node} />}
      <DetailKnowledgeAxes node={node} />
      <DetailAliases node={node} />
      <DetailProperties node={node} />
      <DetailSupportNodes node={node} />
      <DetailMentions node={node} selectedBook={selectedBook} />
    </>
  );
});

function DetailContentSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-24 animate-pulse rounded-lg border border-border-subtle bg-elevated" />
      <div className="h-32 animate-pulse rounded-lg border border-border-subtle bg-elevated" />
      <div className="h-20 animate-pulse rounded-lg border border-border-subtle bg-elevated" />
    </div>
  );
}

export function DetailPanel() {
  const { knowledgeGraph, selectedNodeId, selectedBook, setSelectedNodeId } = useAppState();
  const [width, setWidth] = useState(readPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const visibleNodeRef = useRef<OKMNode | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [isCompact, setIsCompact] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  ));

  useEffect(() => {
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    const handleResize = () => setWidth((current) => clampPanelWidth(current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const handleChange = () => setIsCompact(query.matches);
    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    };
    const handleUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [width]);

  const nudgeWidth = useCallback((delta: number) => {
    setWidth((current) => clampPanelWidth(current + delta));
  }, []);

  const panelMotionClass = isClosing
    ? 'pointer-events-none animate-detail-panel-down lg:animate-detail-panel-out'
    : 'animate-detail-panel-up lg:animate-detail-panel-in';
  const panelClass = `absolute bottom-0 left-0 right-0 z-30 flex max-h-[56vh] w-full shrink-0 flex-col overflow-hidden border-t border-border-subtle bg-surface/95 shadow-panel backdrop-blur ${panelMotionClass} lg:left-auto lg:top-0 lg:max-h-none lg:w-auto lg:border-l lg:border-t-0`;
  const resizeHandle = (
    <div
      role="separator"
      aria-label="调整详情栏宽度"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          nudgeWidth(24);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          nudgeWidth(-24);
        }
      }}
      className={`absolute left-0 top-0 z-10 h-full w-3 -translate-x-1.5 cursor-col-resize outline-none transition-colors ${
        isResizing ? 'bg-accent/25' : 'hover:bg-accent/20 focus:bg-accent/20'
      }`}
    >
      <span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-border-strong" />
    </div>
  );

  const node = knowledgeGraph && selectedNodeId ? knowledgeGraph.nodeById.get(selectedNodeId) : null;
  if (node) visibleNodeRef.current = node;

  useLayoutEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (node) {
      visibleNodeRef.current = node;
      setIsClosing(false);
      return;
    }

    if (!visibleNodeRef.current) return;

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      visibleNodeRef.current = null;
      setIsClosing(false);
      closeTimerRef.current = null;
    }, DETAIL_PANEL_EXIT_MS);
  }, [node]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!node) setExpanded(false);
  }, [node]);

  useEffect(() => {
    const nextNodeId = (node ?? visibleNodeRef.current)?.id;
    if (!nextNodeId || isClosing) return;

    setContentReady(false);
    const timer = window.setTimeout(() => setContentReady(true), 120);
    return () => window.clearTimeout(timer);
  }, [node, isClosing]);

  const detailNode = node ?? visibleNodeRef.current;

  if (isCompact && !detailNode) {
    return null;
  }

  const panelStyle = isCompact ? undefined : { width };
  const maybeResizeHandle = isCompact ? null : resizeHandle;

  if (!detailNode) return null;

  return (
    <>
      <aside
        className={panelClass}
        style={panelStyle}
        aria-hidden={expanded || isClosing}
      >
        {maybeResizeHandle}
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-elevated px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">节点详情</div>
            <div className="mt-0.5 max-w-[14rem] truncate text-[11px] text-text-muted">{detailNode.name}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-sm text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="放大查看节点详情"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              放大
            </button>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="关闭节点详情"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
          <DetailHeader node={detailNode} />
          {contentReady || isClosing ? (
            <NodeDetailBody node={detailNode} selectedBook={selectedBook} />
          ) : (
            <DetailContentSkeleton />
          )}
        </div>
      </aside>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/75 p-4 backdrop-blur-sm animate-fade-in">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭放大详情"
            onClick={() => setExpanded(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="expanded-node-detail-title"
            className="relative flex max-h-[88vh] w-full max-w-5xl animate-slide-up flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-panel"
          >
            <div className="flex items-center justify-between border-b border-border-subtle bg-elevated px-5 py-4">
              <div>
                <div id="expanded-node-detail-title" className="text-base font-semibold text-text-primary">节点详情</div>
                <div className="mt-0.5 max-w-[40rem] truncate text-sm text-text-muted">{detailNode.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                aria-label="关闭放大详情"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 scrollbar-thin">
              <DetailHeader node={detailNode} />
              <NodeDetailBody node={detailNode} selectedBook={selectedBook} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
