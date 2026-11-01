const STOP_WORDS = new Set([
  'para',
  'com',
  'sem',
  'dos',
  'das',
  'uma',
  'por',
  'que',
  'seu',
  'sua',
]);

export function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function formatNcm(value: unknown): string {
  const normalized = normalizeDigits(value).slice(0, 8);
  if (normalized.length !== 8) return normalized;
  return `${normalized.slice(0, 4)}.${normalized.slice(4, 6)}.${normalized.slice(6)}`;
}

export function formatCest(value: unknown): string {
  const normalized = normalizeDigits(value).slice(0, 7);
  if (normalized.length !== 7) return normalized;
  return `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.${normalized.slice(5)}`;
}

export function normalizeCst(value: unknown): string {
  return normalizeDigits(value).slice(0, 3);
}

export function normalizeClassTrib(value: unknown): string {
  return normalizeDigits(value).slice(0, 6);
}

export function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function textScore(query: string, target: string): number {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return 0;

  const targetTokens = new Set(tokens(target));
  const matches = queryTokens.filter((token) => targetTokens.has(token)).length;
  const coverage = matches / queryTokens.length;

  const normalizedQuery = normalizeText(query);
  const normalizedTarget = normalizeText(target);
  const containsBonus = normalizedQuery.length >= 4 && normalizedTarget.includes(normalizedQuery)
    ? 0.25
    : 0;

  return Math.min(1, coverage * 0.75 + containsBonus);
}
