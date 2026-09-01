import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextbookReaderBlock, TextbookReaderInlineSegment, TextbookReaderPageResponse } from '@okm/types';
import { loadTextbookReaderPage } from '@/services/backend-client';
import { useAppState, type TextbookReaderTarget } from '@/hooks/useAppState';
import { BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff, FileText, Info, Layers, Network, X, ZoomIn, ZoomOut } from '@/lib/lucide-icons';
import { continuousReaderPageWindow, nearestReaderPage } from '@/lib/continuous-reader';
import { largestFittingFontSize } from '@/lib/ocr-coordinate-text';
import { PdfPageCanvas } from './PdfPageCanvas';
import { MarkdownView } from './MarkdownView';
import katex from 'katex';
import 'katex/dist/katex.min.css';

type ReaderMode = 'reading' | 'source';

type TextbookReaderProps = {
  sourceKey: string;
  target: TextbookReaderTarget;
  onClose: () => void;
};

function assetUrl(sourceKey: string, value: string | null): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:)/i.test(value) || value.startsWith('/api/')) return value;
  return `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(value)}`;
}

function pdfUrl(sourceKey: string, bookId: string): string {
  return `/api/source/${encodeURIComponent(sourceKey)}/textbooks/${encodeURIComponent(bookId)}/original.pdf`;
}

function MathExpression({ value, display = false }: { value: string; display?: boolean }) {
  let html = '';
  try {
    html = katex.renderToString(value, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    return <span className="font-mono">{value}</span>;
  }
  return <span className={display ? 'block min-w-max' : 'inline'} dangerouslySetInnerHTML={{ __html: html }} />;
}

function InlineContent({ segments, fallback }: { segments: TextbookReaderInlineSegment[]; fallback: string }) {
  if (!segments.length) return <>{fallback}</>;
  return <>{segments.map((segment, index) => (
    segment.kind === 'math'
      ? <MathExpression key={index} value={segment.value} />
      : <span key={index}>{segment.value}</span>
  ))}</>;
}

function safeTableHtml(html: string | null): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button, textarea, select, option, video, audio').forEach((node) => node.remove());
  document.body.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (!['rowspan', 'colspan', 'scope'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
  });
  return document.body.innerHTML;
}

function blockLabel(block: TextbookReaderBlock): string {
  const labels: Record<string, string> = {
    title: '标题',
    paragraph: '正文',
    list: '列表',
    equation_interline: '公式',
    image: '图片',
    chart: '图表',
    table: '表格',
    page_header: '页眉',
    page_footer: '页脚',
    page_number: '页码',
    page_footnote: '脚注',
  };
  return labels[block.type] || block.type;
}

function blockPreview(block: TextbookReaderBlock): string {
  return (block.text || block.caption || block.footnote || block.math || blockLabel(block)).replace(/\s+/g, ' ').trim();
}

function ReaderBlockContent({ block, sourceKey, compact = false }: { block: TextbookReaderBlock; sourceKey: string; compact?: boolean }) {
  const image = assetUrl(sourceKey, block.image_path);
  if (block.type === 'equation_interline' && !compact) {
    return (
      <div className="my-5 overflow-x-auto rounded-lg border border-border-subtle bg-elevated px-5 py-4 text-center text-lg text-text-primary">
        <MathExpression value={block.math || block.text} display />
      </div>
    );
  }
  if (image) {
    return (
      <figure className={compact ? 'h-full w-full' : 'my-5'}>
        <img
          src={image}
          alt={block.caption || block.text || blockLabel(block)}
          loading="lazy"
          className={compact ? 'h-full w-full object-contain' : 'mx-auto max-h-[32rem] max-w-full rounded-lg object-contain shadow-panel'}
        />
        {!compact && (block.caption || block.footnote) && (
          <figcaption className="mx-auto mt-2 max-w-2xl text-center text-sm leading-6 text-text-muted">
            {block.caption}{block.caption && block.footnote ? ' · ' : ''}{block.footnote}
          </figcaption>
        )}
      </figure>
    );
  }
  if (block.type === 'title') {
    return <h2 className={compact ? 'font-semibold leading-[1.08]' : 'mt-7 text-xl font-semibold leading-8 text-text-primary'}><InlineContent segments={block.segments} fallback={block.text} /></h2>;
  }
  if (block.type === 'equation_interline') {
    return <div className="font-serif italic"><MathExpression value={block.math || block.text} /></div>;
  }
  if (block.type === 'list' && block.list_items.length) {
    return (
      <ul className={compact ? 'list-inside list-disc' : 'my-3 list-outside list-disc space-y-2 pl-6 leading-8 text-text-secondary'}>
        {block.list_items.map((item, index) => <li key={index}><InlineContent segments={block.list_item_segments[index] ?? []} fallback={item} /></li>)}
      </ul>
    );
  }
  if (block.type === 'table' && block.html && !compact) {
    return (
      <div
        className="my-5 overflow-x-auto rounded-lg border border-border-subtle bg-surface p-3 text-sm text-text-secondary [&_table]:w-full [&_td]:border [&_td]:border-border-subtle [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border-subtle [&_th]:bg-elevated [&_th]:px-3 [&_th]:py-2"
        dangerouslySetInnerHTML={{ __html: safeTableHtml(block.html) }}
      />
    );
  }
  return <p className={compact ? 'whitespace-pre-wrap break-words leading-[1.08]' : 'my-3 whitespace-pre-wrap text-[15px] leading-8 text-text-secondary'}><InlineContent segments={block.segments} fallback={block.text} /></p>;
}

function OcrCoordinateBlock({
  block,
  sourceKey,
  zoom,
}: {
  block: TextbookReaderBlock;
  sourceKey: string;
  zoom: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fitText = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || box.clientWidth <= 0 || box.clientHeight <= 0) return;

    const minFontSize = Math.max(4, 6 * zoom);
    const maxFontSize = Math.max(minFontSize, 24 * zoom);
    const fits = (fontSize: number) => {
      content.style.fontSize = `${fontSize}px`;
      return content.scrollWidth <= box.clientWidth + 0.5
        && content.scrollHeight <= box.clientHeight + 0.5;
    };
    const fontSize = largestFittingFontSize({ min: minFontSize, max: maxFontSize, fits });
    content.style.fontSize = `${fontSize}px`;
  }, [zoom]);

  useLayoutEffect(() => {
    fitText();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fitText);
    observer.observe(box);
    void document.fonts?.ready.then(fitText);
    return () => observer.disconnect();
  }, [block, fitText]);

  return (
    <div ref={boxRef} className="absolute overflow-hidden" style={{
      left: `${block.bbox![0] / 10}%`,
      top: `${block.bbox![1] / 10}%`,
      width: `${(block.bbox![2] - block.bbox![0]) / 10}%`,
      height: `${(block.bbox![3] - block.bbox![1]) / 10}%`,
    }}>
      <div ref={contentRef} className="h-full w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        <ReaderBlockContent block={block} sourceKey={sourceKey} compact />
      </div>
    </div>
  );
}

function ContinuousReadingPage({
  pageIndex,
  response,
  sourceKey,
  selectedBlockId,
  active,
  onPageRef,
  onSelect,
}: {
  pageIndex: number;
  response: TextbookReaderPageResponse | null;
  sourceKey: string;
  selectedBlockId: string | null;
  active: boolean;
  onPageRef: (pageIndex: number, element: HTMLElement | null) => void;
  onSelect: (pageIndex: number, blockId: string) => void;
}) {
  const highlighted = response?.evidence_match?.page_index === pageIndex
    ? new Set(response.evidence_match.block_ids)
    : new Set<string>();
  const contentBlocks = response?.blocks.filter((block) => !['page_header', 'page_footer', 'page_number'].includes(block.type)) ?? [];

  return (
    <section
      ref={(element) => onPageRef(pageIndex, element)}
      data-page-index={pageIndex}
      aria-label={`Markdown 第 ${pageIndex + 1} 页`}
      aria-current={active ? 'page' : undefined}
      className="min-h-[36rem] scroll-mt-4 border-b border-slate-200 px-5 py-8 last:border-b-0 sm:px-10 sm:py-10 dark:border-border-subtle"
    >
      <div className="mb-7 flex items-center gap-3 text-xs text-slate-500 dark:text-text-muted">
        <span className={`h-px flex-1 ${active ? 'bg-indigo-400/70' : 'bg-slate-200 dark:bg-border-subtle'}`} />
        <span className={`shrink-0 rounded-full px-2.5 py-1 font-medium transition-colors ${active ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-surface'}`}>
          第 {pageIndex + 1} 页
        </span>
        <span className={`h-px flex-1 ${active ? 'bg-indigo-400/70' : 'bg-slate-200 dark:bg-border-subtle'}`} />
      </div>
      {response ? (
        <>
          {contentBlocks.map((block) => {
            const active = highlighted.has(block.id) || selectedBlockId === block.id;
            return (
              <section
                key={block.id}
                tabIndex={0}
                aria-label={`${blockLabel(block)}，内容块 ${block.order_index + 1}`}
                onClick={() => onSelect(pageIndex, block.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(pageIndex, block.id);
                  }
                }}
                className={`group relative cursor-pointer rounded-lg px-3 py-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active ? 'bg-amber-100 ring-2 ring-amber-500 dark:bg-amber-400/10' : 'hover:bg-indigo-50 dark:hover:bg-hover'
                }`}
              >
                <span className="absolute -left-1 top-2 hidden -translate-x-full rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white group-focus-within:block group-hover:block dark:bg-accent">
                  {blockLabel(block)}
                </span>
                <ReaderBlockContent block={block} sourceKey={sourceKey} />
              </section>
            );
          })}
        </>
      ) : (
        <div className="grid min-h-[26rem] place-items-center text-sm text-slate-400 dark:text-text-muted">
          正在载入第 {pageIndex + 1} 页…
        </div>
      )}
    </section>
  );
}

function ContinuousReadingPane({
  response,
  pageResponses,
  sourceKey,
  selectedBlockId,
  navigationRequest,
  onPageEnter,
  onEnsurePage,
  onSelect,
}: {
  response: TextbookReaderPageResponse;
  pageResponses: ReadonlyMap<number, TextbookReaderPageResponse>;
  sourceKey: string;
  selectedBlockId: string | null;
  navigationRequest: PageNavigationRequest | null;
  onPageEnter: (pageIndex: number) => void;
  onEnsurePage: (pageIndex: number) => void;
  onSelect: (blockId: string) => void;
}) {
  const [visiblePageIndex, setVisiblePageIndex] = useState(response.page_index);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const animationFrameRef = useRef<number | null>(null);

  const updateVisiblePage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const pages = Array.from(pageRefs.current, ([pageIndex, element]) => {
      const rect = element.getBoundingClientRect();
      return { pageIndex, top: rect.top, bottom: rect.bottom };
    });
    const nearest = nearestReaderPage(pages, rootRect.top + rootRect.height / 2);
    if (nearest == null) return;
    setVisiblePageIndex((current) => current === nearest ? current : nearest);
    onPageEnter(nearest);
  }, [onPageEnter]);

  const scheduleVisiblePageUpdate = useCallback(() => {
    if (animationFrameRef.current != null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateVisiblePage();
    });
  }, [updateVisiblePage]);

  useEffect(() => {
    for (const pageIndex of continuousReaderPageWindow(visiblePageIndex, response.page_count)) onEnsurePage(pageIndex);
  }, [onEnsurePage, response.page_count, visiblePageIndex]);

  useEffect(() => {
    if (!navigationRequest) return;
    const root = scrollRef.current;
    const page = pageRefs.current.get(navigationRequest.pageIndex);
    if (!root || !page) return;
    const rootRect = root.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const top = root.scrollTop + pageRect.top - rootRect.top;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setVisiblePageIndex(navigationRequest.pageIndex);
    root.scrollTo({ top, behavior: reducedMotion ? 'auto' : navigationRequest.behavior });
    onEnsurePage(navigationRequest.pageIndex);
  }, [navigationRequest, onEnsurePage]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scheduleVisiblePageUpdate);
    observer.observe(root);
    return () => observer.disconnect();
  }, [scheduleVisiblePageUpdate]);

  useEffect(() => () => {
    if (animationFrameRef.current != null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const setPageRef = useCallback((pageIndex: number, element: HTMLElement | null) => {
    if (element) pageRefs.current.set(pageIndex, element);
    else pageRefs.current.delete(pageIndex);
  }, []);

  const selectBlock = (pageIndex: number, blockId: string) => {
    setVisiblePageIndex(pageIndex);
    onPageEnter(pageIndex);
    onSelect(blockId);
  };

  return (
    <section aria-label="Markdown 连续阅读" className="h-full min-h-0 bg-[#f8f6f0] text-slate-900 dark:bg-surface dark:text-text-primary">
      <div
        ref={scrollRef}
        onScroll={scheduleVisiblePageUpdate}
        className="h-full min-h-0 overflow-y-auto overscroll-contain px-0 scrollbar-thin [scrollbar-gutter:stable] sm:px-8"
      >
        <article className="mx-auto min-h-full min-w-0 max-w-4xl border-x border-black/10 bg-white shadow-panel dark:border-border-subtle dark:bg-elevated">
          {Array.from({ length: response.page_count }, (_, pageIndex) => (
            <ContinuousReadingPage
              key={pageIndex}
              pageIndex={pageIndex}
              response={pageResponses.get(pageIndex) ?? null}
              sourceKey={sourceKey}
              selectedBlockId={visiblePageIndex === pageIndex ? selectedBlockId : null}
              active={visiblePageIndex === pageIndex}
              onPageRef={setPageRef}
              onSelect={selectBlock}
            />
          ))}
        </article>
      </div>
    </section>
  );
}

function MarkdownReadingPane({ content, sourceKey }: { content: string; sourceKey: string }) {
  return (
    <section aria-label="Markdown 原文阅读" className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[#f8f6f0] p-4 text-slate-900 scrollbar-thin [scrollbar-gutter:stable] sm:p-8 dark:bg-surface dark:text-text-primary">
      <article className="mx-auto min-w-0 max-w-4xl rounded-xl border border-black/10 bg-white px-6 py-8 shadow-panel sm:px-10 dark:border-border-subtle dark:bg-elevated">
        <MarkdownView
          content={content}
          className="text-base leading-8 text-text-secondary"
          resolveImageUrl={(src) => assetUrl(sourceKey, src)}
          imageLayout="reader"
        />
      </article>
    </section>
  );
}

type PageNavigationRequest = {
  pageIndex: number;
  sequence: number;
  behavior: ScrollBehavior;
};

function blockAtPagePoint(
  element: HTMLDivElement,
  response: TextbookReaderPageResponse,
  clientX: number,
  clientY: number,
): TextbookReaderBlock | null {
  const rect = element.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 1000;
  const y = ((clientY - rect.top) / rect.height) * 1000;
  return response.blocks
    .filter((block) => block.bbox && x >= block.bbox[0] && x <= block.bbox[2] && y >= block.bbox[1] && y <= block.bbox[3])
    .sort((first, second) => {
      const firstArea = first.bbox ? (first.bbox[2] - first.bbox[0]) * (first.bbox[3] - first.bbox[1]) : Number.MAX_SAFE_INTEGER;
      const secondArea = second.bbox ? (second.bbox[2] - second.bbox[0]) * (second.bbox[3] - second.bbox[1]) : Number.MAX_SAFE_INTEGER;
      return firstArea - secondArea;
    })[0] ?? null;
}

function ContinuousSourcePage({
  pageIndex,
  response,
  sourceKey,
  selectedBlockId,
  hoveredBlockId,
  showRegions,
  zoom,
  pdf,
  active,
  renderPage,
  onPageRef,
  onHover,
  onSelect,
}: {
  pageIndex: number;
  response: TextbookReaderPageResponse | null;
  sourceKey: string;
  selectedBlockId: string | null;
  hoveredBlockId: string | null;
  showRegions: boolean;
  zoom: number;
  pdf: string | null;
  active: boolean;
  renderPage: boolean;
  onPageRef: (pageIndex: number, element: HTMLDivElement | null) => void;
  onHover: (blockId: string | null) => void;
  onSelect: (pageIndex: number, blockId: string) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const width = Math.round(680 * zoom);
  const evidenceBlocks = response?.evidence_match?.page_index === pageIndex
    ? new Set(response.evidence_match.block_ids)
    : new Set<string>();
  const handlePageRef = (element: HTMLDivElement | null) => {
    pageRef.current = element;
    onPageRef(pageIndex, element);
  };

  return (
    <article
      ref={handlePageRef}
      data-page-index={pageIndex}
      aria-label={`原教材第 ${pageIndex + 1} 页`}
      aria-current={active ? 'page' : undefined}
      className="scroll-mt-4"
    >
      <div className={`mx-auto mb-2 w-fit rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${active ? 'border-indigo-400/50 bg-indigo-500 text-white' : 'border-border-subtle bg-surface/90 text-text-muted'}`}>
        第 {pageIndex + 1} 页
      </div>
      <div
        className={`relative mx-auto overflow-hidden bg-white text-slate-900 shadow-2xl transition-[width,box-shadow] duration-200 ${active ? 'ring-2 ring-indigo-500/60' : ''}`}
        style={{ width, aspectRatio: pdf ? '521.575 / 737.008' : '0.76 / 1' }}
        onPointerMove={(event) => {
          if (!response || !pageRef.current) return;
          onHover(blockAtPagePoint(event.currentTarget, response, event.clientX, event.clientY)?.id ?? null);
        }}
        onPointerLeave={() => onHover(null)}
        onClick={(event) => {
          if (!response) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return;
          const block = blockAtPagePoint(event.currentTarget, response, event.clientX, event.clientY);
          if (block) onSelect(pageIndex, block.id);
        }}
      >
        {pdf && renderPage && <PdfPageCanvas url={pdf} pageNumber={pageIndex + 1} zoom={zoom} />}
        {pdf && !renderPage && (
          <div className="absolute inset-0 grid place-items-center bg-white text-xs text-slate-400">第 {pageIndex + 1} 页</div>
        )}
        {!pdf && response && response.blocks.map((block) => {
          if (!block.bbox) return null;
          return (
            <OcrCoordinateBlock
              key={`fallback-${block.id}`}
              block={block}
              sourceKey={sourceKey}
              zoom={zoom}
            />
          );
        })}
        {!pdf && !response && (
          <div className="absolute inset-0 grid place-items-center bg-white text-xs text-slate-400">正在载入第 {pageIndex + 1} 页…</div>
        )}
        {response?.blocks.map((block) => {
          if (!block.bbox) return null;
          const [x0, y0, x1, y1] = block.bbox;
          const evidenceActive = evidenceBlocks.has(block.id);
          const selected = active && selectedBlockId === block.id;
          const hovered = active && hoveredBlockId === block.id;
          const visible = showRegions || evidenceActive || selected || hovered;
          return (
            <div
              key={block.id}
              aria-hidden="true"
              className={`pointer-events-none absolute z-20 rounded-[2px] transition-colors duration-150 ${
                evidenceActive
                  ? 'bg-amber-300/25 ring-2 ring-inset ring-amber-500'
                  : selected
                    ? 'bg-indigo-300/20 ring-2 ring-inset ring-indigo-600'
                    : hovered
                      ? 'bg-sky-300/15 ring-1 ring-inset ring-sky-500'
                      : visible
                        ? 'bg-indigo-300/5 ring-1 ring-inset ring-indigo-400/30'
                        : ''
              }`}
              style={{
                left: `${x0 / 10}%`,
                top: `${y0 / 10}%`,
                width: `${Math.max(0.4, (x1 - x0) / 10)}%`,
                height: `${Math.max(0.3, (y1 - y0) / 10)}%`,
              }}
            >
              {(selected || hovered) && (
                <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t bg-slate-900 px-1.5 py-0.5 text-[9px] font-medium text-white">
                  {blockLabel(block)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function SourcePane({
  response,
  pageResponses,
  sourceKey,
  selectedBlockId,
  zoom,
  pdf,
  navigationRequest,
  onPageEnter,
  onEnsurePage,
  onSelect,
  onOpenUnit,
}: {
  response: TextbookReaderPageResponse;
  pageResponses: ReadonlyMap<number, TextbookReaderPageResponse>;
  sourceKey: string;
  selectedBlockId: string | null;
  zoom: number;
  pdf: string | null;
  navigationRequest: PageNavigationRequest | null;
  onPageEnter: (pageIndex: number) => void;
  onEnsurePage: (pageIndex: number) => void;
  onSelect: (blockId: string) => void;
  onOpenUnit: (nodeId: string) => void;
}) {
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(false);
  const [visiblePageIndex, setVisiblePageIndex] = useState(response.page_index);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const animationFrameRef = useRef<number | null>(null);
  const selectedBlock = response.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const relatedUnits = (response.related_units ?? []).filter((unit) => (
    !selectedBlockId || unit.block_ids.length === 0 || unit.block_ids.includes(selectedBlockId)
  ));
  const renderPages = useMemo(
    () => new Set(continuousReaderPageWindow(visiblePageIndex, response.page_count)),
    [response.page_count, visiblePageIndex],
  );

  const updateVisiblePage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const pages = Array.from(pageRefs.current, ([pageIndex, element]) => {
      const rect = element.getBoundingClientRect();
      return { pageIndex, top: rect.top, bottom: rect.bottom };
    });
    const nearest = nearestReaderPage(pages, rootRect.top + rootRect.height / 2);
    if (nearest == null) return;
    setVisiblePageIndex((current) => current === nearest ? current : nearest);
    onPageEnter(nearest);
  }, [onPageEnter]);

  const scheduleVisiblePageUpdate = useCallback(() => {
    if (animationFrameRef.current != null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateVisiblePage();
    });
  }, [updateVisiblePage]);

  useEffect(() => {
    for (const pageIndex of continuousReaderPageWindow(visiblePageIndex, response.page_count)) onEnsurePage(pageIndex);
  }, [onEnsurePage, response.page_count, visiblePageIndex]);

  useEffect(() => {
    if (!navigationRequest) return;
    const root = scrollRef.current;
    const page = pageRefs.current.get(navigationRequest.pageIndex);
    if (!root || !page) return;
    const rootRect = root.getBoundingClientRect();
    const pageRect = page.getBoundingClientRect();
    const top = root.scrollTop + pageRect.top - rootRect.top - 16;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setVisiblePageIndex(navigationRequest.pageIndex);
    root.scrollTo({ top, behavior: reducedMotion ? 'auto' : navigationRequest.behavior });
    onEnsurePage(navigationRequest.pageIndex);
  }, [navigationRequest, onEnsurePage]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scheduleVisiblePageUpdate);
    observer.observe(root);
    return () => observer.disconnect();
  }, [scheduleVisiblePageUpdate]);

  useEffect(() => () => {
    if (animationFrameRef.current != null) window.cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const setPageRef = useCallback((pageIndex: number, element: HTMLDivElement | null) => {
    if (element) pageRefs.current.set(pageIndex, element);
    else pageRefs.current.delete(pageIndex);
  }, []);

  const selectBlock = (pageIndex: number, blockId: string) => {
    setVisiblePageIndex(pageIndex);
    onPageEnter(pageIndex);
    onSelect(blockId);
  };

  return (
    <section aria-label={pdf ? '增强 PDF 版式阅读' : 'OCR 坐标预览'} className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-deep lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-1">
      <div ref={scrollRef} onScroll={scheduleVisiblePageUpdate} className="min-h-0 min-w-0 overflow-auto overscroll-contain p-4 scrollbar-thin sm:p-8">
        <div className="mx-auto flex w-fit flex-col gap-8 pb-6">
          {Array.from({ length: response.page_count }, (_, pageIndex) => (
            <ContinuousSourcePage
              key={pageIndex}
              pageIndex={pageIndex}
              response={pageResponses.get(pageIndex) ?? null}
              sourceKey={sourceKey}
              selectedBlockId={selectedBlockId}
              hoveredBlockId={hoveredBlockId}
              showRegions={showRegions}
              zoom={zoom}
              pdf={pdf}
              active={visiblePageIndex === pageIndex}
              renderPage={renderPages.has(pageIndex)}
              onPageRef={setPageRef}
              onHover={setHoveredBlockId}
              onSelect={selectBlock}
            />
          ))}
        </div>
      </div>

      <aside aria-label="教材交互信息" className="min-h-0 border-t border-border-subtle bg-surface lg:border-l lg:border-t-0">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Info className="h-4 w-4 text-indigo-400" />交互信息
            </div>
            <button
              type="button"
              aria-pressed={showRegions}
              onClick={() => setShowRegions((value) => !value)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {showRegions ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showRegions ? '隐藏区域' : '显示区域'}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
            <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/10 p-3 text-xs leading-5 text-text-secondary">
              向下滚动可连续阅读整本教材。原 PDF 决定视觉版式；页码与本栏内容会跟随当前页面更新。
            </div>

            {response.evidence_match && response.evidence_match.kind !== 'none' && (
              <section className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3" aria-label="知识证据定位">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                  <Layers className="h-3.5 w-3.5" />知识证据
                </div>
                <p className="mt-2 text-xs leading-5 text-text-secondary">
                  {response.evidence_match.excerpt || `已定位 ${response.evidence_match.block_ids.length} 个原页区域`}
                </p>
                {response.evidence_match.kind === 'text' && (
                  <p className="mt-1 text-[11px] text-text-muted">文本匹配可信度 {Math.round(response.evidence_match.confidence * 100)}%</p>
                )}
              </section>
            )}

            <section className="mt-4" aria-live="polite">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">当前选择</div>
              {selectedBlock ? (
                <div className="rounded-lg border border-indigo-400/30 bg-elevated p-3 shadow-panel">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">{blockLabel(selectedBlock)}</span>
                    <span className="text-[10px] text-text-muted">内容块 {selectedBlock.order_index + 1}</span>
                  </div>
                  <div className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-text-primary">
                    {selectedBlock.type === 'equation_interline'
                      ? <MathExpression value={selectedBlock.math || selectedBlock.text} display />
                      : blockPreview(selectedBlock)}
                  </div>
                  {selectedBlock.image_path && (
                    <img src={assetUrl(sourceKey, selectedBlock.image_path)} alt={selectedBlock.caption || '选中的教材图片'} className="mt-3 max-h-36 w-full rounded-md border border-border-subtle bg-white object-contain" />
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border-default px-3 py-5 text-center text-xs leading-5 text-text-muted">
                  单击原页中的文字、公式或图片区域查看详情
                </div>
              )}
            </section>

            <section className="mt-5" aria-label="原文关联知识">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  <Network className="h-3.5 w-3.5" />关联知识
                </div>
                <span className="text-[10px] text-text-muted">{relatedUnits.length} 个</span>
              </div>
              {relatedUnits.length > 0 ? (
                <div className="space-y-2">
                  {relatedUnits.map((unit) => (
                    <button
                      key={unit.node_id}
                      type="button"
                      onClick={() => onOpenUnit(unit.node_id)}
                      className="block w-full cursor-pointer rounded-lg border border-border-subtle bg-elevated p-3 text-left transition-colors duration-200 hover:border-indigo-400/45 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      aria-label={`在图谱中查看知识单元：${unit.name}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-text-primary">{unit.name}</span>
                          <span className="mt-1 block text-[10px] text-text-muted">{unit.kind || '知识点'} · {unit.evidence_ids.length} 条原文证据</span>
                        </span>
                        <Network className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                      </span>
                      {(unit.summary || unit.definition) && (
                        <span className="mt-2 line-clamp-3 block text-[11px] leading-5 text-text-secondary">
                          {unit.summary || unit.definition}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-xs leading-5 text-text-muted">
                  {selectedBlockId ? '当前原文块还没有关联知识单元' : '本页还没有关联知识单元'}
                </div>
              )}
            </section>

            <section className="mt-5" aria-label="本页 OCR 内容">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted"><FileText className="h-3.5 w-3.5" />本页内容</div>
                <span className="text-[10px] text-text-muted">{response.block_count} 块</span>
              </div>
              <div className="space-y-1.5">
                {response.blocks.filter((block) => !['page_header', 'page_footer', 'page_number'].includes(block.type)).map((block) => (
                  <button
                    key={`outline-${block.id}`}
                    type="button"
                    onClick={() => onSelect(block.id)}
                    aria-pressed={selectedBlockId === block.id}
                    className={`block w-full cursor-pointer rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      selectedBlockId === block.id
                        ? 'border-indigo-400/40 bg-indigo-500/15 text-text-primary'
                        : 'border-transparent text-text-secondary hover:border-border-subtle hover:bg-hover hover:text-text-primary'
                    }`}
                  >
                    <span className="block text-[9px] font-semibold text-text-muted">{blockLabel(block)}</span>
                    <span className="mt-0.5 block truncate text-[11px]">{blockPreview(block)}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      </aside>
    </section>
  );
}

export function TextbookReader({ sourceKey, target, onClose }: TextbookReaderProps) {
  const { setSelectedNodeId, setWorkspace } = useAppState();
  const [response, setResponse] = useState<TextbookReaderPageResponse | null>(null);
  const [pageResponses, setPageResponses] = useState<ReadonlyMap<number, TextbookReaderPageResponse>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ReaderMode>(target.mode ?? 'source');
  const [zoom, setZoom] = useState(1);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState('1');
  const [navigationRequest, setNavigationRequest] = useState<PageNavigationRequest | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pageResponsesRef = useRef(new Map<number, TextbookReaderPageResponse>());
  const inFlightPageRequests = useRef(new Map<number, Promise<TextbookReaderPageResponse>>());
  const responseRef = useRef<TextbookReaderPageResponse | null>(null);
  const activePageRef = useRef(0);
  const navigationSequence = useRef(0);
  const cacheGeneration = useRef(0);

  const storePageResponse = useCallback((payload: TextbookReaderPageResponse) => {
    const next = new Map(pageResponsesRef.current);
    next.set(payload.page_index, payload);
    pageResponsesRef.current = next;
    setPageResponses(next);
  }, []);

  const ensurePage = useCallback((pageIndex: number): Promise<TextbookReaderPageResponse> => {
    const cached = pageResponsesRef.current.get(pageIndex);
    if (cached) return Promise.resolve(cached);
    const existing = inFlightPageRequests.current.get(pageIndex);
    if (existing) return existing;
    const generation = cacheGeneration.current;
    const request = loadTextbookReaderPage(sourceKey, target.bookId, { page: pageIndex })
      .then((payload) => {
        if (generation === cacheGeneration.current) storePageResponse(payload);
        return payload;
      })
      .finally(() => {
        if (inFlightPageRequests.current.get(pageIndex) === request) inFlightPageRequests.current.delete(pageIndex);
      });
    inFlightPageRequests.current.set(pageIndex, request);
    return request;
  }, [sourceKey, storePageResponse, target.bookId]);

  const activatePage = useCallback((pageIndex: number) => {
    activePageRef.current = pageIndex;
    const applyActiveResponse = (payload: TextbookReaderPageResponse) => {
      if (activePageRef.current !== pageIndex || responseRef.current?.page_index === pageIndex) return;
      responseRef.current = payload;
      setResponse(payload);
      setSelectedBlockId(payload.evidence_match?.block_ids[0] ?? null);
    };
    const cached = pageResponsesRef.current.get(pageIndex);
    if (cached) {
      applyActiveResponse(cached);
      return;
    }
    void ensurePage(pageIndex).then(applyActiveResponse).catch(() => undefined);
  }, [ensurePage]);

  const requestPage = useCallback((pageIndex: number) => {
    void ensurePage(pageIndex).catch(() => undefined);
  }, [ensurePage]);

  const navigateToPage = useCallback((pageIndex: number, behavior: ScrollBehavior = 'smooth') => {
    const pageCount = responseRef.current?.page_count;
    if (!pageCount) return;
    const nextPage = Math.min(pageCount - 1, Math.max(0, pageIndex));
    activePageRef.current = nextPage;
    setNavigationRequest({ pageIndex: nextPage, sequence: ++navigationSequence.current, behavior });
    activatePage(nextPage);
  }, [activatePage]);

  useEffect(() => {
    const generation = ++cacheGeneration.current;
    pageResponsesRef.current = new Map();
    inFlightPageRequests.current = new Map();
    responseRef.current = null;
    activePageRef.current = 0;
    setPageResponses(new Map());
    setResponse(null);
    setSelectedBlockId(null);
    setNavigationRequest(null);
    setMode(target.mode ?? 'source');
    setLoading(true);
    setError('');
    const initialPage = target.evidenceId ? undefined : target.pageNumber != null ? Math.max(0, target.pageNumber - 1) : undefined;
    void loadTextbookReaderPage(sourceKey, target.bookId, { page: initialPage, evidenceId: target.evidenceId })
      .then((payload) => {
        if (generation !== cacheGeneration.current) return;
        storePageResponse(payload);
        responseRef.current = payload;
        activePageRef.current = payload.page_index;
        setResponse(payload);
        setSelectedBlockId(payload.evidence_match?.block_ids[0] ?? null);
        setNavigationRequest({ pageIndex: payload.page_index, sequence: ++navigationSequence.current, behavior: 'auto' });
      })
      .catch((loadError) => {
        if (generation === cacheGeneration.current) setError((loadError as Error).message || '电子教材加载失败');
      })
      .finally(() => {
        if (generation === cacheGeneration.current) setLoading(false);
      });
  }, [sourceKey, storePageResponse, target.bookId, target.evidenceId, target.mode, target.pageNumber]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (response) setPageInput(String(response.page_number));
  }, [response]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const inputActive = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') onClose();
      if (!inputActive && event.key === 'ArrowLeft' && response && response.page_index > 0) navigateToPage(response.page_index - 1);
      if (!inputActive && event.key === 'ArrowRight' && response && response.page_index < response.page_count - 1) navigateToPage(response.page_index + 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigateToPage, onClose, response]);

  const match = response?.evidence_match;
  const originalPdf = response?.pdf_available ? pdfUrl(sourceKey, target.bookId) : null;
  const matchText = match?.kind === 'asset'
    ? '已按图片资源精确定位'
    : match?.kind === 'text'
      ? `已按正文匹配定位 · 可信度 ${Math.round(match.confidence * 100)}%`
      : match?.kind === 'page'
        ? '仅定位到证据页，当前数据没有句子级坐标'
        : match?.kind === 'none'
          ? '未找到对应 OCR 内容块'
          : '';
  const commitPageInput = () => {
    if (!response) return;
    const page = Number(pageInput);
    if (Number.isInteger(page) && page >= 1 && page <= response.page_count) {
      if (page !== response.page_number) navigateToPage(page - 1);
    } else {
      setPageInput(String(response.page_number));
    }
  };
  const openRelatedUnit = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setWorkspace('graph');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-deep text-text-primary" role="dialog" aria-modal="true" aria-labelledby="textbook-reader-title">
      <a href="#textbook-reader-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-white">
        跳到教材正文
      </a>
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface/95 px-3 py-2.5 shadow-panel backdrop-blur sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 id="textbook-reader-title" className="truncate text-sm font-semibold">{target.title || target.bookId}</h1>
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{mode === 'source' && response?.pdf_available ? 'PDF 原文 · OCR / 知识交互层' : target.markdown ? 'Markdown 原文渲染' : 'OCR 语义阅读'}</p>
          </div>
        </div>

        <div className="order-3 flex w-full items-center justify-between gap-2 sm:order-none sm:w-auto sm:justify-start">
          <div className="flex rounded-lg border border-border-subtle bg-elevated p-0.5" role="group" aria-label="阅读模式">
            {([
              ['reading', 'MD 渲染'],
              ['source', response?.pdf_available ? 'PDF 原文' : 'OCR 坐标'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${mode === value ? 'bg-indigo-500 text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'source' && (
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-elevated p-0.5">
              <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="缩小原页"><ZoomOut className="h-3.5 w-3.5" /></button>
              <span className="min-w-10 text-center text-[10px] text-text-muted">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="放大原页"><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>

        <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border-subtle bg-elevated text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="关闭电子教材">
          <X className="h-4 w-4" />
        </button>
      </header>

      {matchText && (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-400/10 px-4 py-2 text-xs text-amber-200" aria-live="polite">
          <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0"><strong className="font-semibold">证据定位：</strong>{matchText}{match?.excerpt ? ` · ${match.excerpt.slice(0, 100)}` : ''}</span>
        </div>
      )}

      <main id="textbook-reader-content" className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-text-muted" aria-live="polite">正在生成电子教材页面…</div>
        ) : error ? (
          <div className="grid h-full place-items-center p-8">
            <div className="max-w-lg rounded-xl border border-red-400/25 bg-red-400/10 p-5 text-sm leading-6 text-red-200">
              <div className="font-semibold">无法打开电子教材</div>
              <div className="mt-2">{error}</div>
            </div>
          </div>
        ) : response ? (
          mode === 'reading'
            ? target.markdown
              ? <MarkdownReadingPane content={target.markdown} sourceKey={sourceKey} />
              : <ContinuousReadingPane response={response} pageResponses={pageResponses} sourceKey={sourceKey} selectedBlockId={selectedBlockId} navigationRequest={navigationRequest} onPageEnter={activatePage} onEnsurePage={requestPage} onSelect={setSelectedBlockId} />
            : <SourcePane response={response} pageResponses={pageResponses} sourceKey={sourceKey} selectedBlockId={selectedBlockId} zoom={zoom} pdf={originalPdf} navigationRequest={navigationRequest} onPageEnter={activatePage} onEnsurePage={requestPage} onSelect={setSelectedBlockId} onOpenUnit={openRelatedUnit} />
        ) : null}
      </main>

      <footer className="flex items-center justify-between gap-3 border-t border-border-subtle bg-surface px-3 py-2 sm:px-5">
        <button type="button" disabled={!response || response.page_index <= 0 || loading} onClick={() => response && navigateToPage(response.page_index - 1)} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft className="h-3.5 w-3.5" />上一页
        </button>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <label htmlFor="textbook-reader-page">第</label>
          <input
            id="textbook-reader-page"
            type="number"
            min={1}
            max={response?.page_count || 1}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitPageInput();
              }
            }}
            className="w-16 rounded-md border border-border-subtle bg-elevated px-2 py-1 text-center text-text-primary outline-none focus:border-indigo-500"
          />
          <span>/ {response?.page_count || '—'} 页</span>
        </div>
        <button type="button" disabled={!response || response.page_index >= response.page_count - 1 || loading} onClick={() => response && navigateToPage(response.page_index + 1)} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
          下一页<ChevronRight className="h-3.5 w-3.5" />
        </button>
      </footer>
    </div>
  );
}
