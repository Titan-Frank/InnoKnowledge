import type { EnrichBookSummary } from '@/services/backend-client';

function normalizeEnrichSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function enrichSearchTerms(value: string): string[] {
  const lower = value.toLowerCase();
  const terms = value.split(/[\s/_·-]+/).map(normalizeEnrichSearch).filter((term) => term.length >= 2);
  const aliases: Array<[RegExp, string[]]> = [
    [/physics|物理/, ['物理']],
    [/chemistry|chem|化学/, ['化学']],
    [/biology|bio|生物/, ['生物']],
    [/mathematics|math|数学/, ['数学']],
    [/hukj|沪科技|沪科教/, ['沪科技', '沪科教']],
    [/pep|\brj\b|人教/, ['人教']],
    [/junior|初中/, ['初中']],
    [/senior|高中/, ['高中']],
  ];
  aliases.forEach(([pattern, values]) => {
    if (pattern.test(lower)) terms.push(...values.map(normalizeEnrichSearch));
  });
  const compulsory = lower.match(/(?:compulsory|必修)[\s_-]*(?:第)?([1-6一二三四五六])/);
  if (compulsory?.[1]) {
    const numerals: Record<string, string> = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
    const numeral = numerals[compulsory[1]] || compulsory[1];
    terms.push(normalizeEnrichSearch(`必修第${numeral}册`), normalizeEnrichSearch(`必修${numeral}`));
  }
  const selective = lower.match(/(?:xb|选择性必修)[\s_-]*([1-6一二三四五六])/);
  if (selective?.[1]) {
    const numerals: Record<string, string> = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
    const numeral = numerals[selective[1]] || selective[1];
    terms.push(normalizeEnrichSearch(`选择性必修第${numeral}册`), normalizeEnrichSearch(`选择性必修${numeral}`));
  }
  return [...new Set(terms)];
}

export function scoreEnrichBook(book: EnrichBookSummary, query: string): number {
  const haystack = normalizeEnrichSearch([
    book.title, book.path, book.subject, book.stage, book.grade, book.course, book.publisher, book.volume,
  ].filter(Boolean).join(' '));
  const normalizedQuery = normalizeEnrichSearch(query);
  const terms = enrichSearchTerms(query);
  if (!normalizedQuery && terms.length === 0) return 1;
  let score = normalizedQuery.length >= 3 && haystack.includes(normalizedQuery) ? 200 : 0;
  terms.forEach((term) => {
    if (haystack.includes(term)) score += Math.min(40, 8 + term.length * 2);
  });
  return score;
}

export function topEnrichBook(books: EnrichBookSummary[], query: string): EnrichBookSummary | null {
  let bestBook: EnrichBookSummary | null = null;
  let bestScore = -1;
  for (const book of books) {
    const score = scoreEnrichBook(book, query);
    if (score <= 0) continue;
    if (!bestBook || score > bestScore || (score === bestScore && book.title.localeCompare(bestBook.title, 'zh-CN') < 0)) {
      bestBook = book;
      bestScore = score;
    }
  }
  return bestBook;
}
