import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask, TextLayer as PdfTextLayer } from 'pdfjs-dist';

type PdfJsModule = typeof import('pdfjs-dist');
type LoadedPdf = { document: PDFDocumentProxy; pdfjs: PdfJsModule };

const documentCache = new Map<string, Promise<LoadedPdf>>();

async function loadPdfDocument(url: string): Promise<LoadedPdf> {
  const cached = documentCache.get(url);
  if (cached) return cached;
  const promise = Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const assetRoot = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.origin).href;
    return pdfjs.getDocument({
      url,
      cMapUrl: `${assetRoot}cmaps/`,
      cMapPacked: true,
      iccUrl: `${assetRoot}iccs/`,
      standardFontDataUrl: `${assetRoot}standard_fonts/`,
      wasmUrl: `${assetRoot}wasm/`,
    }).promise.then((document) => ({ document, pdfjs }));
  }).catch((error) => {
    documentCache.delete(url);
    throw error;
  });
  documentCache.set(url, promise);
  return promise;
}

export function PdfPageCanvas({ url, pageNumber, zoom }: { url: string; pageNumber: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState(521.575 / 737.008);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const cssWidth = Math.round(680 * zoom);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: PdfTextLayer | null = null;
    setStatus('loading');
    loadPdfDocument(url)
      .then(async ({ document, pdfjs }) => {
        const page = await document.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = cssWidth / baseViewport.width;
        const cssViewport = page.getViewport({ scale: cssScale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: cssScale * pixelRatio });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${Math.round(baseViewport.height * cssScale)}px`;
        setAspectRatio(baseViewport.width / baseViewport.height);
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas 2D context is unavailable.');
        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        const renderTextLayer = async () => {
          const container = textLayerRef.current;
          if (!container) return;
          container.replaceChildren();
          container.style.setProperty('--total-scale-factor', String(cssScale));
          container.style.setProperty('--scale-round-x', '1px');
          container.style.setProperty('--scale-round-y', '1px');
          const textContent = await page.getTextContent();
          if (cancelled || !textLayerRef.current) return;
          textLayer = new pdfjs.TextLayer({
            textContentSource: textContent,
            container,
            viewport: cssViewport,
          });
          await textLayer.render();
        };
        await Promise.all([renderTask.promise, renderTextLayer().catch(() => undefined)]);
        if (!cancelled) setStatus('ready');
      })
      .catch((error) => {
        if (cancelled || error instanceof Error && error.name === 'RenderingCancelledException') return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [cssWidth, pageNumber, url]);

  return (
    <div className="relative bg-white" style={{ width: cssWidth, aspectRatio }}>
      <canvas ref={canvasRef} aria-label={`原 PDF 第 ${pageNumber} 页`} className={`block transition-opacity duration-200 ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`} />
      <div ref={textLayerRef} className="pdf-text-layer" aria-label={`可选择的 PDF 文本，第 ${pageNumber} 页`} />
      {status === 'loading' && <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">正在渲染原 PDF…</div>}
      {status === 'error' && <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs leading-5 text-red-600">原 PDF 页面渲染失败，请检查文件是否仍在教材 OCR 目录中。</div>}
    </div>
  );
}
