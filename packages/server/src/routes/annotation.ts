import type { Hono } from 'hono';
import type {
  AnnotationLessonSummary,
  AnnotationLessonTextResponse,
  AnnotationTextbookListResponse,
  AnnotationTextbookSummary,
} from '@okm/types';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../utils/paths.js';

type Heading = {
  line: number;
  level: number;
  text: string;
};

const MINERU_DIR = path.resolve(DATA_DIR, 'mineru');

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function repoDataPath(filePath: string): string {
  const relative = path.relative(DATA_DIR, filePath).split(path.sep).join('/');
  return `data/${relative}`;
}

async function markdownPathForBook(bookId: string): Promise<string | null> {
  const filePath = path.resolve(MINERU_DIR, bookId, 'full.md');
  if (!isInside(MINERU_DIR, filePath)) return null;
  try {
    const info = await stat(filePath);
    return info.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

function markdownHeadings(lines: string[]): Heading[] {
  return lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      return {
        line: index + 1,
        level: match[1]!.length,
        text: match[2]!.trim(),
      };
    })
    .filter((item): item is Heading => item !== null);
}

function cleanTitlePart(value: string): string {
  return value
    .replace(/[A-Z]{2,}(?:\s+[A-Z]{2,})*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveBookTitle(bookId: string, lines: string[]): string {
  const tocIndex = lines.findIndex((line) => /^(#{1,6}\s*)?目\s*录\s*$/.test(line.trim()));
  const titleLines = lines.slice(0, tocIndex > 0 ? tocIndex : 90);
  const parts: string[] = [];
  for (const line of titleLines) {
    const raw = line.replace(/^#{1,6}\s+/, '').trim();
    const text = cleanTitlePart(raw);
    if (!text || text.length > 32) continue;
    if (/普通高中教科书|上海|出版社|主编|编写|责任编辑|ISBN|版权所有|声明|印刷|发行|书号|定价/.test(text)) continue;
    if (!/[一-龥]/.test(text)) continue;
    if (!parts.includes(text)) parts.push(text);
    if (parts.length >= 4) break;
  }
  return parts.length > 0 ? parts.join(' ') : bookId;
}

function isLessonHeading(text: string): boolean {
  const normalized = text.trim();
  if (/^第\s*[0-9一二三四五六七八九十百千万]+\s*[节课]\s+/.test(normalized)) return true;
  if (/^[0-9]+\.[0-9]+(?:\.[0-9]+)?\s+\S/.test(normalized)) return true;
  return false;
}

function parseHeadingLabel(text: string, fallbackIndex: number): string {
  const chinese = /^(第\s*[0-9一二三四五六七八九十百千万]+\s*[节课])\s+(.+)$/.exec(text);
  if (chinese) return chinese[1]!.replace(/\s+/g, '');
  const dotted = /^([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s+(.+)$/.exec(text);
  if (dotted) return dotted[1]!;
  return `第${fallbackIndex}课`;
}

function parseHeadingTitle(text: string): string {
  const chinese = /^(第\s*[0-9一二三四五六七八九十百千万]+\s*[节课])\s+(.+)$/.exec(text);
  if (chinese) return chinese[2]!.trim();
  const dotted = /^([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s+(.+)$/.exec(text);
  if (dotted) return dotted[2]!.trim();
  return text.trim();
}

function previewFor(lines: string[]): string {
  return lines
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter((line) => line && !/^!\[[^\]]*\]\(/.test(line))
    .slice(0, 4)
    .join(' ')
    .slice(0, 180);
}

function deriveLessons(bookId: string, sourcePath: string, lines: string[]): AnnotationLessonSummary[] {
  const lessonHeadings = markdownHeadings(lines).filter((heading) => isLessonHeading(heading.text));
  const selected = lessonHeadings.length > 0
    ? lessonHeadings
    : markdownHeadings(lines).filter((heading) => heading.level <= 2).slice(0, 20);

  return selected.map((heading, index) => {
    const next = selected[index + 1];
    const mdStart = heading.line;
    const mdEnd = Math.max(mdStart, (next?.line ?? lines.length + 1) - 1);
    const label = parseHeadingLabel(heading.text, index + 1);
    const title = parseHeadingTitle(heading.text);
    const lessonLines = lines.slice(mdStart - 1, mdEnd);
    return {
      lesson_id: `${bookId}:line-${mdStart}`,
      title,
      label,
      source_path: sourcePath,
      md_start: mdStart,
      md_end: mdEnd,
      line_count: mdEnd - mdStart + 1,
      page_start: null,
      page_end: null,
      preview: previewFor(lessonLines),
    };
  });
}

async function loadTextbook(bookId: string): Promise<AnnotationTextbookSummary | null> {
  const filePath = await markdownPathForBook(bookId);
  if (!filePath) return null;
  const text = await readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const sourcePath = repoDataPath(filePath);
  const lessons = deriveLessons(bookId, sourcePath, lines);
  return {
    book_id: bookId,
    title: deriveBookTitle(bookId, lines),
    source_path: sourcePath,
    line_count: lines.length,
    lesson_count: lessons.length,
    lessons,
  };
}

async function listTextbooks(): Promise<AnnotationTextbookSummary[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(MINERU_DIR);
  } catch {
    return [];
  }

  const books = await Promise.all(entries.map((entry) => loadTextbook(entry)));
  return books
    .filter((book): book is AnnotationTextbookSummary => book !== null)
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

export function registerAnnotationRoutes(app: Hono) {
  app.get('/api/annotation/textbooks', async (c) => {
    const books = await listTextbooks();
    const payload: AnnotationTextbookListResponse = {
      generated_at: new Date().toISOString(),
      books,
    };
    return c.json(payload);
  });

  app.get('/api/annotation/textbooks/:bookId/lessons/:lessonId', async (c) => {
    const bookId = c.req.param('bookId');
    const lessonId = c.req.param('lessonId');
    const book = await loadTextbook(bookId);
    if (!book) return c.json({ error: `Unknown textbook '${bookId}'` }, 404);

    const lesson = book.lessons.find((item) => item.lesson_id === lessonId);
    if (!lesson) return c.json({ error: `Unknown lesson '${lessonId}'` }, 404);

    const filePath = await markdownPathForBook(bookId);
    if (!filePath) return c.json({ error: `Markdown not found for '${bookId}'` }, 404);

    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    const selectedLines = lines.slice(lesson.md_start - 1, lesson.md_end);
    const { lessons: _lessons, ...bookSummary } = book;
    const payload: AnnotationLessonTextResponse = {
      book: bookSummary,
      lesson: {
        ...lesson,
        lines: selectedLines,
        source_text: selectedLines.join('\n'),
      },
    };
    return c.json(payload);
  });
}
