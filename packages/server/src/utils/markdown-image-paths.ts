import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.js';

export type SourceLineCache = Map<string, string[] | null>;

type Row = Record<string, unknown>;

export function resolveEvidenceImagePath(row: Row, sourceCache?: SourceLineCache): string {
  const rawPath = rawImagePathFromEvidence(row);
  const sourcePath = sourcePathFromEvidence(row);
  if (rawPath) {
    const resolvedRawPath = resolveImagePathAgainstSource(rawPath, sourcePath);
    if (/^https?:\/\//i.test(resolvedRawPath) || existsSync(resolvedRawPath)) return resolvedRawPath;
  }

  const resolvedSourcePath = resolveSourcePath(sourcePath);
  if (!resolvedSourcePath) return '';

  const lines = readSourceLines(resolvedSourcePath, sourceCache);
  if (!lines) return '';

  const sourceLine =
    findImageSourceLine(lines, rawPath, '', textValue(row.excerpt)) ||
    lineNumberFromLocator(textValue(row.locator));
  if (!sourceLine || sourceLine < 1 || sourceLine > lines.length) return '';

  const nearbyPath = findNearbyMarkdownImagePath(lines, sourceLine);
  return nearbyPath ? resolveImagePathAgainstSource(nearbyPath, sourcePath) : '';
}

export function sourcePathFromEvidence(row: Row): string {
  const properties = evidenceProperties(row);
  return textValue(row.source_path || properties.source_path);
}

export function rawImagePathFromEvidence(row: Row): string {
  const properties = evidenceProperties(row);
  const directPath = textValue(
    properties.path ||
    properties.image_path ||
    properties.src ||
    row.image_path,
  );
  return directPath || imageLikePathFromText(textValue(row.locator)) || imageLikePathFromText(textValue(row.excerpt));
}

function imageLikePathFromText(value: string): string {
  const markdownPath = imagePathFromMarkup(value);
  if (markdownPath) return markdownPath;
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(value) ? value : '';
}

export function resolveSourcePath(sourcePath: string): string {
  if (!sourcePath || /^https?:\/\//i.test(sourcePath)) return '';
  return path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(REPO_ROOT, sourcePath);
}

export function resolveExistingMineruAssetPath(
  value: string,
  mineruRoot = path.resolve(REPO_ROOT, 'data', 'mineru'),
): string {
  const resolved = path.resolve(value);
  if (existsSync(resolved)) return resolved;

  const relativePath = path.relative(mineruRoot, resolved);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return resolved;
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length < 2) return resolved;
  const requestedBookDirectory = parts[0]!;
  const assetSuffix = parts.slice(1);
  const safeBookDirectory = requestedBookDirectory
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '__')
    .replace(/^[._]+|[._]+$/g, '') || 'item';
  const candidates = [
    path.join(mineruRoot, safeBookDirectory, ...assetSuffix),
    path.join(mineruRoot, safeBookDirectory, 'extract', ...assetSuffix),
    path.join(mineruRoot, requestedBookDirectory, 'extract', ...assetSuffix),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || resolved;
}

export function readSourceLines(sourcePath: string, sourceCache?: SourceLineCache): string[] | null {
  if (sourceCache?.has(sourcePath)) return sourceCache.get(sourcePath) ?? null;
  let lines: string[] | null = null;
  try {
    if (existsSync(sourcePath)) lines = readFileSync(sourcePath, 'utf8').split(/\r?\n/);
  } catch {
    lines = null;
  }
  sourceCache?.set(sourcePath, lines);
  return lines;
}

export function findImageSourceLine(lines: string[], rawImagePath: string, imagePath: string, excerpt: string): number | null {
  const candidates = imagePathCandidates(rawImagePath, imagePath, imagePathFromMarkup(excerpt));
  for (let index = 0; index < lines.length; index += 1) {
    if (candidates.some((candidate) => lines[index]?.includes(candidate))) return index + 1;
  }

  const normalizedExcerpt = cleanContextLine(excerpt);
  if (normalizedExcerpt.length < 8) return null;
  for (let index = 0; index < lines.length; index += 1) {
    if (cleanContextLine(lines[index] ?? '').includes(normalizedExcerpt)) return index + 1;
  }
  for (const fragment of excerptSearchFragments(excerpt)) {
    for (let index = 0; index < lines.length; index += 1) {
      if (cleanContextLine(lines[index] ?? '').includes(fragment)) return index + 1;
    }
  }
  return null;
}

export function lineNumberFromLocator(locator: string): number | null {
  const match = /line:(\d+)/i.exec(locator);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cleanContextLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match: string, alt: string, src: string) => {
      const label = alt.trim() || path.basename(src.trim()) || '图片';
      return `[图片：${label}]`;
    })
    .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_match: string, src: string) => {
      const label = path.basename(src.trim()) || '图片';
      return `[图片：${label}]`;
    })
    .replace(/^#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function imagePathFromMarkup(value: string): string {
  return /!\[[^\]]*\]\(([^)\n]+)\)/.exec(value)?.[1]?.trim() ??
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(value)?.[1]?.trim() ??
    '';
}

function findNearbyMarkdownImagePath(lines: string[], sourceLine: number): string {
  const sourceIndex = sourceLine - 1;
  const windowSize = 16;
  for (let index = sourceIndex; index >= Math.max(0, sourceIndex - windowSize); index -= 1) {
    const imagePath = imagePathFromMarkup(lines[index] ?? '');
    if (imagePath) return imagePath;
  }
  for (let index = sourceIndex + 1; index <= Math.min(lines.length - 1, sourceIndex + windowSize); index += 1) {
    const imagePath = imagePathFromMarkup(lines[index] ?? '');
    if (imagePath) return imagePath;
  }
  return '';
}

function excerptSearchFragments(excerpt: string): string[] {
  const withoutImages = cleanContextLine(excerpt)
    .replace(/\[图片：[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fragments = new Set<string>();
  for (const sentence of withoutImages.split(/[。！？；]/)) {
    const fragment = sentence.trim();
    if (fragment.length >= 12) fragments.add(fragment.slice(0, 80));
  }
  if (withoutImages.length >= 12) fragments.add(withoutImages.slice(0, 80));
  return [...fragments];
}

function resolveImagePathAgainstSource(rawPath: string, sourcePath: string): string {
  const cleanPath = rawPath.trim();
  if (!cleanPath || /^https?:\/\//i.test(cleanPath)) return cleanPath;
  const withoutQuery = cleanPath.split(/[?#]/, 1)[0] || cleanPath;
  if (path.isAbsolute(withoutQuery)) return path.resolve(withoutQuery);

  const candidates: string[] = [];
  const resolvedSourcePath = resolveSourcePath(sourcePath);
  if (resolvedSourcePath) candidates.push(path.resolve(path.dirname(resolvedSourcePath), withoutQuery));
  candidates.push(path.resolve(REPO_ROOT, withoutQuery));

  const exactMatch = candidates.find((candidate) => existsSync(candidate));
  if (exactMatch) return exactMatch;
  return candidates[0] ? resolveExistingMineruAssetPath(candidates[0]) : withoutQuery;
}

function imagePathCandidates(...values: string[]): string[] {
  const candidates = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    candidates.add(trimmed);
    candidates.add(safeDecodeURIComponent(trimmed));
    const base = path.basename(trimmed);
    if (base) candidates.add(base);
  }
  return [...candidates].filter((candidate) => candidate.length > 0);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function evidenceProperties(row: Row): Row {
  const properties = asRecord(row.properties);
  if (Object.keys(properties).length > 0) return properties;
  return asRecord(row.properties_json);
}

function asRecord(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}
