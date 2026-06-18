import type { ReactNode } from 'react';

type MarkdownViewProps = {
  content: string;
  className?: string;
  resolveImageUrl?: (src: string) => string | undefined;
};

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

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
      const group = readBraceGroup(value, i);
      if (group) {
        script = group.content;
        i = group.end;
      } else {
        script = value[i] ?? '';
        i += 1;
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

function renderInline(text: string, keyPrefix: string, resolveImageUrl?: (src: string) => string | undefined): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /!\[([^\]]*)\]\(([^)\n]+)\)|!\[([^\]]*)\]\(([^)\s]+…)|\$\$\s*([^$]+?)\s*\$\$|\$([^$\n]+)\$|`([^`]+)`|\*\*([^*]+)\*\*/g;
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
          <img
            key={`${keyPrefix}:img:${index}`}
            src={resolved}
            alt={alt}
            className="my-2 max-h-72 w-full border border-border-subtle bg-surface object-contain"
            loading="lazy"
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
      nodes.push(
        <code key={`${keyPrefix}:code:${index}`} className="bg-surface px-1 py-0.5 font-mono text-[0.95em] text-text-primary">
          {match[7]}
        </code>,
      );
    } else if (match[8] != null) {
      nodes.push(
        <strong key={`${keyPrefix}:strong:${index}`} className="font-semibold text-text-primary">
          {match[8]}
        </strong>,
      );
    }

    lastIndex = tokenRe.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderImageLine(line: string, key: string, resolveImageUrl?: (src: string) => string | undefined): ReactNode {
  const images = Array.from(line.matchAll(IMAGE_RE));
  IMAGE_RE.lastIndex = 0;
  return (
    <div key={key} className="space-y-2">
      {images.map((image, index) => {
        const alt = image[1] || '教材图片';
        const src = image[2].trim();
        const resolved = resolveImageUrl?.(src) ?? src;
        return (
          <figure key={`${key}:figure:${index}`} className="overflow-hidden border border-border-subtle bg-elevated">
            <img src={resolved} alt={alt} className="max-h-80 w-full bg-surface object-contain" loading="lazy" />
            {alt === '教材图片' ? null : (
              <figcaption className="border-t border-border-subtle px-2 py-1 text-[10px] text-text-muted">
                {alt}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}

export function MarkdownView({ content, className = '', resolveImageUrl }: MarkdownViewProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trim().startsWith('$$')) {
      const firstLine = line.trim();
      const singleLine = firstLine.match(/^\$\$\s*(.*?)\s*\$\$$/);
      if (singleLine) {
        blocks.push(renderDisplayMath(singleLine[1], `math-block:${i}`));
        i += 1;
        continue;
      }

      const formulaLines: string[] = [];
      const openingRemainder = firstLine.replace(/^\$\$\s*/, '').trim();
      if (openingRemainder) formulaLines.push(openingRemainder);
      i += 1;
      while (i < lines.length && !lines[i].trim().endsWith('$$')) {
        formulaLines.push(lines[i].trim());
        i += 1;
      }
      if (i < lines.length) {
        const closingRemainder = lines[i].trim().replace(/\s*\$\$$/, '').trim();
        if (closingRemainder) formulaLines.push(closingRemainder);
        i += 1;
      }
      blocks.push(renderDisplayMath(formulaLines.join(' '), `math-block:${i}`));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag key={`h:${i}`} className="mt-3 font-semibold leading-snug text-text-primary first:mt-0">
          {renderInline(heading[2], `h:${i}`, resolveImageUrl)}
        </Tag>,
      );
      i += 1;
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
      blocks.push(
        <div key={`table:${i}`} className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index} className="border border-border-subtle bg-surface px-2 py-1 font-medium text-text-primary">
                    {renderInline(cell, `th:${i}:${index}`, resolveImageUrl)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-border-subtle px-2 py-1 align-top text-text-secondary">
                      {renderInline(cell, `td:${i}:${rowIndex}:${cellIndex}`, resolveImageUrl)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
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
            <li key={index}>{renderInline(item, `ul:${i}:${index}`, resolveImageUrl)}</li>
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
            <li key={index}>{renderInline(item, `ol:${i}:${index}`, resolveImageUrl)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (isImageOnly(line)) {
      blocks.push(renderImageLine(line, `img:${i}`, resolveImageUrl));
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
        {renderInline(paragraph.join('\n'), `p:${i}`, resolveImageUrl)}
      </p>,
    );
  }

  return <div className={`markdown-view space-y-3 ${className}`.trim()}>{blocks}</div>;
}
