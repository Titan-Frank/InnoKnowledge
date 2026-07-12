import { useState, type ReactNode } from 'react';

type MarkdownViewProps = {
  content: string;
  className?: string;
  resolveImageUrl?: (src: string) => string | undefined;
  renderEvidenceRef?: (evidenceId: string, key: string) => ReactNode;
  hideDecorativeImages?: boolean;
  imageLayout?: 'inline' | 'preview' | 'reader';
};

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MIN_USEFUL_IMAGE_SIDE = 64;
const MIN_USEFUL_IMAGE_AREA = 5000;

function isDecorativeImage(width: number, height: number): boolean {
  if (!width || !height) return false;
  const smallerSide = Math.min(width, height);
  const largerSide = Math.max(width, height);
  const area = width * height;
  return smallerSide < MIN_USEFUL_IMAGE_SIDE || area < MIN_USEFUL_IMAGE_AREA || (largerSide / smallerSide > 8 && smallerSide < 120);
}

function MarkdownImage({
  src,
  alt,
  className,
  figureClassName = '',
  framed = false,
  hideDecorative = true,
}: {
  src: string;
  alt: string;
  className: string;
  figureClassName?: string;
  framed?: boolean;
  hideDecorative?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const image = (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onLoad={(event) => {
        const imageEl = event.currentTarget;
        if (hideDecorative && isDecorativeImage(imageEl.naturalWidth, imageEl.naturalHeight)) setHidden(true);
      }}
    />
  );

  if (!framed) return image;

  return (
    <figure className={`overflow-hidden border border-border-subtle bg-elevated ${figureClassName}`.trim()}>
      {image}
      {alt === '教材图片' ? null : (
        <figcaption className="border-t border-border-subtle px-2 py-1 text-[10px] text-text-muted">
          {alt}
        </figcaption>
      )}
    </figure>
  );
}

function trimTableCell(value: string): string {
  return value.trim().replace(/^\\\|/, '|').replace(/\\\|$/, '|');
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(trimTableCell);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isHtmlTableStart(line: string): boolean {
  return /<table\b/i.test(line);
}

function isHtmlDetailsStart(line: string): boolean {
  return /<details\b/i.test(line);
}

function isImageOnly(line: string): boolean {
  const withoutImages = line.replace(IMAGE_RE, '').trim();
  IMAGE_RE.lastIndex = 0;
  return withoutImages.length === 0 && /!\[[^\]]*\]\([^)]+\)/.test(line);
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return (
    /^#{1,6}\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    isImageOnly(line) ||
    isHtmlTableStart(line) ||
    isHtmlDetailsStart(line) ||
    (line.includes('|') && isTableDivider(next))
  );
}

function readBraceGroup(value: string, start: number): { content: string; end: number } | null {
  if (value[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return { content: value.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

function skipSpaces(value: string, start: number): number {
  let index = start;
  while (/\s/.test(value[index] ?? '')) index += 1;
  return index;
}

function renderMathNodes(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const commandText: Record<string, string> = {
    cdot: '·',
    circ: '°',
    Delta: 'Δ',
    delta: 'δ',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    pi: 'π',
    sigma: 'σ',
    mu: 'μ',
    times: '×',
    quad: ' ',
    qquad: '  ',
    to: '→',
    rightarrow: '→',
    leftrightarrow: '↔',
  };
  let textBuffer = '';
  let i = 0;
  let partIndex = 0;

  const flushText = () => {
    if (!textBuffer) return;
    nodes.push(textBuffer);
    textBuffer = '';
  };

  while (i < value.length) {
    const char = value[i];

    if (char === '\\') {
      const match = value.slice(i + 1).match(/^[A-Za-z]+/);
      const command = match?.[0] ?? '';
      if (!command) {
        i += 1;
        continue;
      }
      i += command.length + 1;

      if (command === 'left' || command === 'right') continue;

      if (command === 'mathrm' || command === 'text') {
        const groupStart = skipSpaces(value, i);
        const group = readBraceGroup(value, groupStart);
        if (group) {
          flushText();
          nodes.push(...renderMathNodes(group.content, `${keyPrefix}:rm:${partIndex}`));
          partIndex += 1;
          i = group.end;
        }
        continue;
      }

      if (command === 'frac') {
        const numeratorStart = skipSpaces(value, i);
        const numerator = readBraceGroup(value, numeratorStart);
        const denominatorStart = numerator ? skipSpaces(value, numerator.end) : numeratorStart;
        const denominator = readBraceGroup(value, denominatorStart);
        if (numerator && denominator) {
          flushText();
          nodes.push(
            <span key={`${keyPrefix}:frac:${partIndex}`} className="inline-flex items-center gap-0.5 align-middle">
              <sup className="text-[0.72em] leading-none">{renderMathNodes(numerator.content, `${keyPrefix}:frac-n:${partIndex}`)}</sup>
              <span>/</span>
              <sub className="text-[0.72em] leading-none">{renderMathNodes(denominator.content, `${keyPrefix}:frac-d:${partIndex}`)}</sub>
            </span>,
          );
          partIndex += 1;
          i = denominator.end;
          continue;
        }
      }

      textBuffer += commandText[command] ?? command;
      continue;
    }

    if (char === '_' || char === '^') {
      const isSubscript = char === '_';
      let script = '';
      i += 1;
      const scriptStart = skipSpaces(value, i);
      const group = readBraceGroup(value, scriptStart);
      if (group) {
        script = group.content;
        i = group.end;
      } else {
        script = value[scriptStart] ?? '';
        i = scriptStart + 1;
      }
      flushText();
      const Tag = isSubscript ? 'sub' : 'sup';
      nodes.push(
        <Tag key={`${keyPrefix}:script:${partIndex}`} className="text-[0.72em] leading-none">
          {renderMathNodes(script, `${keyPrefix}:script:${partIndex}`)}
        </Tag>,
      );
      partIndex += 1;
      continue;
    }

    if (char === '{' || char === '}') {
      i += 1;
      continue;
    }

    textBuffer += char;
    i += 1;
  }

  flushText();
  return nodes;
}

function renderMath(value: string, key: string): ReactNode {
  return (
    <span key={key} className="font-mono text-[0.98em] text-text-primary">
      {renderMathNodes(value, key)}
    </span>
  );
}

function renderDisplayMath(value: string, key: string): ReactNode {
  return (
    <div key={key} className="overflow-x-auto border border-border-subtle bg-surface px-3 py-2 text-center">
      <span className="font-mono text-sm text-text-primary">{renderMathNodes(value, key)}</span>
    </div>
  );
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    deg: '°',
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    Delta: 'Δ',
    mu: 'μ',
    pi: 'π',
    sigma: 'σ',
    times: '×',
    middot: '·',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return namedEntities[entity] ?? match;
  });
}

function cleanHtmlTableCell(value: string): string {
  const cleaned = decodeHtmlEntities(
    value
      .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '_{$1}')
      .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^{$1}')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  );
  if (/^[A-Za-z][A-Za-z0-9_{}^+\-()[\]\\]+$/.test(cleaned) && /[_^]/.test(cleaned)) {
    return `$${cleaned}$`;
  }
  return cleaned;
}

function parseHtmlTable(markup: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(markup)) !== null) {
    const row: string[] = [];
    const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      row.push(cleanHtmlTableCell(cellMatch[1]));
    }

    if (row.length > 0) rows.push(row);
  }

  return rows;
}

function renderTableBlock(
  header: string[],
  rows: string[][],
  key: string,
  resolveImageUrl?: (src: string) => string | undefined,
  renderEvidenceRef?: MarkdownViewProps['renderEvidenceRef'],
): ReactNode {
  return (
    <div key={key} className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} className="border border-border-subtle bg-surface px-2 py-1 font-medium text-text-primary">
                {renderInline(cell, `${key}:th:${index}`, resolveImageUrl, 'inline', renderEvidenceRef)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-border-subtle px-2 py-1 align-top text-text-secondary">
                  {renderInline(cell, `${key}:td:${rowIndex}:${cellIndex}`, resolveImageUrl, 'inline', renderEvidenceRef)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderHtmlTable(
  markup: string,
  key: string,
  resolveImageUrl?: (src: string) => string | undefined,
  renderEvidenceRef?: MarkdownViewProps['renderEvidenceRef'],
): ReactNode {
  const rows = parseHtmlTable(markup);
  if (rows.length === 0) {
    return (
      <p key={key} className="whitespace-pre-line">
        {renderInline(cleanHtmlTableCell(markup), `${key}:fallback`, resolveImageUrl, 'inline', renderEvidenceRef)}
      </p>
    );
  }

  const [header, ...bodyRows] = rows;
  return renderTableBlock(header, bodyRows, key, resolveImageUrl, renderEvidenceRef);
}

function renderHtmlDetails(
  markup: string,
  key: string,
  resolveImageUrl?: (src: string) => string | undefined,
  renderEvidenceRef?: MarkdownViewProps['renderEvidenceRef'],
  hideDecorativeImages = true,
  imageLayout: MarkdownViewProps['imageLayout'] = 'inline',
): ReactNode {
  const summaryMatch = markup.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  const summary = summaryMatch ? cleanHtmlTableCell(summaryMatch[1]) : '详情';
  const body = markup
    .replace(/<details\b[^>]*>/i, '')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, '')
    .replace(/<\/details>/i, '')
    .trim();

  return (
    <details key={key} className="border border-border-subtle bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-primary">
        {renderInline(summary, `${key}:summary`, resolveImageUrl, 'inline', renderEvidenceRef)}
      </summary>
      {body ? (
        <div className="border-t border-border-subtle px-3 py-2">
          <MarkdownView
            content={body}
            resolveImageUrl={resolveImageUrl}
            renderEvidenceRef={renderEvidenceRef}
            hideDecorativeImages={hideDecorativeImages}
            imageLayout={imageLayout}
          />
        </div>
      ) : null}
    </details>
  );
}

function inlineImageClass(imageLayout: MarkdownViewProps['imageLayout']): string {
  if (imageLayout === 'reader') return 'my-4 max-h-[60vh] w-full rounded-md border border-border-subtle bg-elevated object-contain';
  if (imageLayout === 'preview') return 'my-3 mx-auto max-h-56 w-auto max-w-full rounded-md border border-border-subtle bg-elevated object-contain';
  return 'my-2 max-h-72 w-full border border-border-subtle bg-surface object-contain';
}

function blockImageClass(imageLayout: MarkdownViewProps['imageLayout']): string {
  if (imageLayout === 'reader') return 'max-h-[68vh] w-full bg-elevated object-contain';
  if (imageLayout === 'preview') return 'mx-auto max-h-56 w-auto max-w-full bg-elevated object-contain';
  return 'max-h-80 w-full bg-surface object-contain';
}

function blockFigureClass(imageLayout: MarkdownViewProps['imageLayout']): string {
  if (imageLayout === 'reader') return 'rounded-lg bg-elevated p-3';
  if (imageLayout === 'preview') return 'rounded-md bg-elevated p-2';
  return '';
}

function renderInline(
  text: string,
  keyPrefix: string,
  resolveImageUrl?: (src: string) => string | undefined,
  imageLayout: MarkdownViewProps['imageLayout'] = 'inline',
  renderEvidenceRef?: MarkdownViewProps['renderEvidenceRef'],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /!\[([^\]]*)\]\(([^)\n]+)\)|!\[([^\]]*)\]\(([^)\s]+…)|\$\$\s*([^$]+?)\s*\$\$|\$([^$\n]+)\$|`?\[(evidence:[^\]\s`]+)\]`?|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));

    if (match[2] != null || match[4] != null) {
      const alt = match[1] || match[3] || '图片';
      const src = (match[2] || match[4] || '').trim();
      const resolved = resolveImageUrl?.(src);
      if (resolved) {
        nodes.push(
          <MarkdownImage
            key={`${keyPrefix}:img:${index}`}
            src={resolved}
            alt={alt}
            className={inlineImageClass(imageLayout)}
          />,
        );
      } else if (!src.includes('…')) {
        nodes.push(
          <span key={`${keyPrefix}:missing-img:${index}`} className="text-text-muted">
            [图片未找到]
          </span>,
        );
      }
    } else if (match[5] != null || match[6] != null) {
      nodes.push(renderMath(match[5] || match[6], `${keyPrefix}:math:${index}`));
    } else if (match[7] != null) {
      const evidenceId = match[7];
      nodes.push(
        renderEvidenceRef
          ? renderEvidenceRef(evidenceId, `${keyPrefix}:evidence:${index}`)
          : (
            <sup key={`${keyPrefix}:evidence:${index}`} className="align-super text-[0.68em] font-medium text-text-muted">
              [证据]
            </sup>
          ),
      );
    } else if (match[8] != null) {
      nodes.push(
        <code key={`${keyPrefix}:code:${index}`} className="bg-surface px-1 py-0.5 font-mono text-[0.95em] text-text-primary">
          {match[8]}
        </code>,
      );
    } else if (match[9] != null) {
      nodes.push(
        <strong key={`${keyPrefix}:strong:${index}`} className="font-semibold text-text-primary">
          {match[9]}
        </strong>,
      );
    }

    lastIndex = tokenRe.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderImageLine(
  line: string,
  key: string,
  resolveImageUrl?: (src: string) => string | undefined,
  hideDecorativeImages = true,
  imageLayout: MarkdownViewProps['imageLayout'] = 'inline',
): ReactNode {
  const images = Array.from(line.matchAll(IMAGE_RE));
  IMAGE_RE.lastIndex = 0;
  return (
    <div key={key} className="space-y-2">
      {images.map((image, index) => {
        const alt = image[1] || '教材图片';
        const src = image[2].trim();
        const resolved = resolveImageUrl ? resolveImageUrl(src) : src;
        if (!resolved) {
          return src.includes('…') ? null : (
            <span key={`${key}:missing-img:${index}`} className="text-sm text-text-muted">
              [图片未找到]
            </span>
          );
        }
        return (
          <MarkdownImage
            key={`${key}:figure:${index}`}
            src={resolved}
            alt={alt}
            className={blockImageClass(imageLayout)}
            figureClassName={blockFigureClass(imageLayout)}
            framed
            hideDecorative={hideDecorativeImages}
          />
        );
      })}
    </div>
  );
}

export function MarkdownView({
  content,
  className = '',
  resolveImageUrl,
  renderEvidenceRef,
  hideDecorativeImages = true,
  imageLayout = 'inline',
}: MarkdownViewProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  const appendDisplayMath = (formula: string, suffix: string, key: string) => {
    blocks.push(
      <div key={key} className={suffix ? 'space-y-1' : undefined}>
        {renderDisplayMath(formula, `${key}:formula`)}
        {suffix ? (
          <div className="text-center text-xs leading-none">
            {renderInline(suffix, `${key}:suffix`, resolveImageUrl, imageLayout, renderEvidenceRef)}
          </div>
        ) : null}
      </div>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trim().startsWith('$$')) {
      const firstLine = line.trim();
      const singleLine = firstLine.match(/^\$\$\s*(.*?)\s*\$\$(.*)$/);
      if (singleLine) {
        appendDisplayMath(singleLine[1], singleLine[2].trim(), `math-block:${i}`);
        i += 1;
        continue;
      }

      const formulaLines: string[] = [];
      const openingRemainder = firstLine.replace(/^\$\$\s*/, '').trim();
      if (openingRemainder) formulaLines.push(openingRemainder);
      i += 1;
      while (i < lines.length && !lines[i].includes('$$')) {
        formulaLines.push(lines[i].trim());
        i += 1;
      }
      let suffix = '';
      if (i < lines.length) {
        const closingLine = lines[i].trim();
        const closingIndex = closingLine.indexOf('$$');
        const closingRemainder = closingLine.slice(0, closingIndex).trim();
        if (closingRemainder) formulaLines.push(closingRemainder);
        suffix = closingLine.slice(closingIndex + 2).trim();
        i += 1;
      }
      appendDisplayMath(formulaLines.join(' '), suffix, `math-block:${i}`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag key={`h:${i}`} className="mt-3 font-semibold leading-snug text-text-primary first:mt-0">
          {renderInline(heading[2], `h:${i}`, resolveImageUrl, imageLayout, renderEvidenceRef)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (isHtmlTableStart(line)) {
      const tableLines = [line];
      i += 1;
      while (i < lines.length && !/<\/table>/i.test(tableLines.join('\n'))) {
        tableLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /<\/table>/i.test(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      blocks.push(renderHtmlTable(tableLines.join('\n'), `html-table:${i}`, resolveImageUrl, renderEvidenceRef));
      continue;
    }

    if (isHtmlDetailsStart(line)) {
      const detailsLines = [line];
      i += 1;
      while (i < lines.length && !/<\/details>/i.test(detailsLines.join('\n'))) {
        detailsLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /<\/details>/i.test(lines[i])) {
        detailsLines.push(lines[i]);
        i += 1;
      }
      blocks.push(renderHtmlDetails(detailsLines.join('\n'), `html-details:${i}`, resolveImageUrl, renderEvidenceRef, hideDecorativeImages, imageLayout));
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[i + 1] ?? '')) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(renderTableBlock(header, rows, `table:${i}`, resolveImageUrl, renderEvidenceRef));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul:${i}`} className="list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ul:${i}:${index}`, resolveImageUrl, imageLayout, renderEvidenceRef)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol:${i}`} className="list-decimal space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `ol:${i}:${index}`, resolveImageUrl, imageLayout, renderEvidenceRef)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (isImageOnly(line)) {
      blocks.push(renderImageLine(line, `img:${i}`, resolveImageUrl, hideDecorativeImages, imageLayout));
      i += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) {
      paragraph.push(lines[i].trimEnd());
      i += 1;
    }
    blocks.push(
      <p key={`p:${i}`} className="whitespace-pre-line">
        {renderInline(paragraph.join('\n'), `p:${i}`, resolveImageUrl, imageLayout, renderEvidenceRef)}
      </p>,
    );
  }

  return <div className={`markdown-view space-y-3 ${className}`.trim()}>{blocks}</div>;
}
