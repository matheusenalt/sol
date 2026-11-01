import type { CestItem, Confidence } from './types.js';
import { normalizeDigits, textScore } from './normalize.js';

export type CestMatch = {
  item: CestItem;
  matchKind: 'exato' | 'prefixo' | 'capítulo';
  prefixLength: number;
  compatibility: number;
  confidence: Confidence;
};

export function cestMatchesNcm(expression: string, ncmInput: string): { matches: boolean; kind?: CestMatch['matchKind']; prefixLength?: number } {
  const ncm = normalizeDigits(ncmInput);
  if (ncm.length !== 8 || ncm === '00000000') return { matches: false };
  const source = String(expression || '').trim();
  if (!source) return { matches: false };

  if (/cap[ií]tulo/i.test(source)) {
    const chapter = Number(ncm.slice(0, 2));
    const chapters = parseChapters(source);
    return chapters.has(chapter)
      ? { matches: true, kind: 'capítulo', prefixLength: 2 }
      : { matches: false };
  }

  const prefixes = source
    .split(/[,;]/)
    .map((part) => normalizeDigits(part))
    .filter((digits) => digits.length >= 2 && digits.length <= 8);

  let best = 0;
  for (const prefix of prefixes) {
    if (ncm.startsWith(prefix) && prefix.length > best) best = prefix.length;
  }
  if (!best) return { matches: false };
  return {
    matches: true,
    kind: best === 8 ? 'exato' : 'prefixo',
    prefixLength: best,
  };
}

export function findCestForNcm(rows: CestItem[], ncmInput: string, productDescription = ''): CestMatch[] {
  const ncm = normalizeDigits(ncmInput);
  if (ncm.length !== 8 || ncm === '00000000') return [];

  return rows
    .map((item): CestMatch | null => {
      const match = cestMatchesNcm(item.ncm, ncm);
      if (!match.matches || !match.kind) return null;
      const textCompatibility = productDescription.trim()
        ? textScore(productDescription, item.descricao || '')
        : 0;
      const structural = match.prefixLength === 8 ? 0.88 : match.prefixLength && match.prefixLength >= 6 ? 0.78 : match.prefixLength && match.prefixLength >= 4 ? 0.66 : 0.52;
      const compatibility = productDescription.trim()
        ? Math.min(1, structural * 0.65 + textCompatibility * 0.35)
        : structural;
      const confidence: Confidence = compatibility >= 0.78
        ? 'alta'
        : compatibility >= 0.58
          ? 'média'
          : 'baixa';
      return {
        item,
        matchKind: match.kind,
        prefixLength: match.prefixLength || 0,
        compatibility,
        confidence,
      };
    })
    .filter((item): item is CestMatch => Boolean(item))
    .sort((a, b) => b.compatibility - a.compatibility || b.prefixLength - a.prefixLength || a.item.cest.localeCompare(b.item.cest));
}

export function isCestCompatible(rows: CestItem[], ncmInput: string, cestInput: string): boolean {
  const cest = normalizeDigits(cestInput);
  if (cest.length !== 7) return false;
  return findCestForNcm(rows, ncmInput).some((match) => normalizeDigits(match.item.cest) === cest);
}

function parseChapters(source: string): Set<number> {
  const output = new Set<number>();
  const normalized = source.replace(/[–—-]/g, ' a ');

  for (const match of normalized.matchAll(/\b(\d{1,2})\s+a\s+(\d{1,2})\b/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= 1 && end <= 97 && start <= end) {
      for (let value = start; value <= end; value += 1) output.add(value);
    }
  }

  for (const match of normalized.matchAll(/\b\d{1,2}\b/g)) {
    const value = Number(match[0]);
    if (value >= 1 && value <= 97) output.add(value);
  }
  return output;
}
