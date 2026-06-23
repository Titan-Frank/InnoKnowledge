import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { DetailHeader } from './sections/DetailHeader';
import { DetailDescription } from './sections/DetailDescription';
import { DetailKnowledgeAxes } from './sections/DetailKnowledgeAxes';
import { DetailAliases } from './sections/DetailAliases';
import { DetailProperties } from './sections/DetailProperties';
import { DetailSupportNodes } from './sections/DetailSupportNodes';
import { DetailUnit } from './sections/DetailUnit';
import { DetailMentions } from './sections/DetailMentions';
import { Network } from '@/lib/lucide-icons';

const DETAIL_PANEL_WIDTH_KEY = 'okm-detail-panel-width';
const DEFAULT_DETAIL_PANEL_WIDTH = 384;
const MIN_DETAIL_PANEL_WIDTH = 320;
const MAX_DETAIL_PANEL_WIDTH = 760;

function clampPanelWidth(value: number): number {
  const viewportLimit = typeof window === 'undefined' ? MAX_DETAIL_PANEL_WIDTH : Math.floor(window.innerWidth * 0.65);
  return Math.min(Math.max(value, MIN_DETAIL_PANEL_WIDTH), Math.min(MAX_DETAIL_PANEL_WIDTH, viewportLimit));
}

function readPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DETAIL_PANEL_WIDTH;
  const stored = Number(window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY));
  return clampPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DETAIL_PANEL_WIDTH);
}

export function DetailPanel() {
  const { knowledgeGraph, selectedNodeId, selectedBook } = useAppState();
  const [width, setWidth] = useState(readPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
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

  const panelClass = 'relative order-3 flex max-h-[45vh] w-full shrink-0 flex-col overflow-hidden border-t border-border-subtle bg-surface lg:order-none lg:max-h-none lg:w-auto lg:border-l lg:border-t-0';
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

  if (isCompact && !node) {
    return null;
  }

  const panelStyle = isCompact ? undefined : { width };
  const maybeResizeHandle = isCompact ? null : resizeHandle;

  if (!node) {
    return (
      <aside
        className="relative order-3 hidden shrink-0 flex-col items-center justify-center border-l border-border-subtle bg-surface text-text-muted lg:flex"
        style={{ width: 64 }}
        title="选择节点查看详情"
      >
        <Network className="h-5 w-5" />
        <span className="mt-2 text-xs [writing-mode:vertical-rl]">节点详情</span>
      </aside>
    );
  }

  return (
    <aside className={panelClass} style={panelStyle}>
      {maybeResizeHandle}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <DetailHeader node={node} />
        <DetailUnit node={node} />
        {!node.description ? null : <DetailDescription node={node} />}
        <DetailKnowledgeAxes node={node} />
        <DetailAliases node={node} />
        <DetailProperties node={node} />
        <DetailSupportNodes node={node} />
        <DetailMentions node={node} selectedBook={selectedBook} />
      </div>
    </aside>
  );
}
