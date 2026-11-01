export type ParsedFiscalProductLine = {
  codigo: string;
  descricao: string;
  ncm: string;
};

const UNIT_TOKENS = new Set([
  'UN', 'UND', 'UNID', 'UNIDADE', 'KG', 'G', 'MG', 'L', 'LT', 'LTS', 'ML',
  'CX', 'CAIXA', 'PC', 'PÇ', 'PCA', 'PCT', 'PAC', 'FD', 'FARDO', 'SC', 'SACO',
  'DZ', 'PAR', 'KIT', 'MT', 'M', 'M2', 'M3', 'BD', 'BALDE', 'GL', 'GARRAFA',
]);

const NON_PRODUCT_PREFIXES = [
  'dados fiscais de produtos', 'data de impressao', 'data de impressão',
  'codigo produto', 'código produto', 'codigo descricao', 'código descrição',
  'total ', 'subtotal ', 'pagina ', 'página ',
];

/**
 * Parser textual para relatórios fiscais em que uma linha de produto segue a ideia:
 * Código | Produto | UN | NCM | ...demais colunas fiscais...
 *
 * Ele deliberadamente ignora tudo após o NCM. Isso evita que ICMS/PIS/COFINS,
 * estoque, preço etc. sejam anexados ao nome do produto.
 */
export function parseFiscalProductLine(text: string): ParsedFiscalProductLine | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  const lower = normalizePlain(clean);
  if (NON_PRODUCT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
  if (/\b(codigo|código)\b.*\bproduto\b.*\bncm\b/i.test(clean)) return null;

  const ncmMatch = findNcmMatch(clean);
  if (!ncmMatch) return null;

  const beforeNcm = clean.slice(0, ncmMatch.index).trim();
  if (!beforeNcm) return null;

  let parts = beforeNcm.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  // O primeiro elemento da linha é o código interno. Ele pode ser numérico com zeros à esquerda.
  const codigo = stripPunctuation(parts.shift() || '');
  if (!looksLikeProductCode(codigo)) return null;

  // A unidade normalmente aparece imediatamente antes do NCM e não faz parte da descrição.
  while (parts.length && isUnit(parts[parts.length - 1])) parts.pop();

  let descricao = parts.join(' ').trim();
  descricao = descricao.replace(/^[-–—|:;,.]+|[-–—|:;,.]+$/g, '').trim();
  if (!descricao || descricao.length < 2) return null;

  // Evita linhas de cabeçalho/rodapé que por acaso contenham oito dígitos.
  const normalizedDescription = normalizePlain(descricao);
  if (/^(produto|descricao|descrição|ncm|cest|icms|pis|cofins|total|subtotal)$/.test(normalizedDescription)) return null;

  return { codigo, descricao: descricao.slice(0, 500), ncm: ncmMatch.ncm };
}

export function detectCompanyFromPdfTextLines(lines: string[]): string {
  const cleaned = lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30);

  // Alguns geradores colocam empresa + título no mesmo objeto de texto.
  for (const line of cleaned) {
    const match = line.match(/^(.*?)\s+(?:Dados\s+Fiscais\s+de\s+Produtos|Lista\s+de\s+(?:Preço|Preços|Produtos))\b/i);
    if (match?.[1] && isCompanyCandidate(match[1])) return match[1].trim().slice(0, 140);
  }

  // Só olha o cabeçalho: nunca deixa uma linha de produto competir com o nome da empresa.
  const headerIndex = cleaned.findIndex((line) => /\b(?:c[oó]digo|cod)\b.*\bproduto\b.*\bncm\b/i.test(line));
  const titleIndex = cleaned.findIndex((line) => /\b(?:dados fiscais de produtos|lista de pre[cç]os?|lista de produtos)\b/i.test(line));
  const stop = [headerIndex, titleIndex].filter((index) => index >= 0).reduce((min, index) => Math.min(min, index), cleaned.length);
  const candidates = cleaned.slice(0, stop || Math.min(cleaned.length, 12))
    .filter(isCompanyCandidate)
    .map((text, index) => ({ text, score: companyScore(text, index) }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.text.slice(0, 140) || '';
}

function findNcmMatch(text: string): { ncm: string; index: number } | null {
  const regex = /(?<!\d)(\d{4}[.\-\s]?\d{2}[.\-\s]?\d{2}|\d{8})(?!\d)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const digits = match[1].replace(/\D/g, '');
    if (digits.length !== 8 || digits === '00000000') continue;
    const chapter = Number(digits.slice(0, 2));
    if (chapter >= 1 && chapter <= 97) return { ncm: digits, index: match.index };
  }
  return null;
}

function looksLikeProductCode(value: string): boolean {
  if (!value || value.length > 30) return false;
  if (!/[0-9]/.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value);
}

function isUnit(value: string): boolean {
  const normalized = value.toUpperCase().replace(/[.:;,]/g, '').trim();
  return UNIT_TOKENS.has(normalized);
}

function stripPunctuation(value: string): string {
  return value.replace(/^[:|;,-]+|[:|;,-]+$/g, '').trim();
}

function normalizePlain(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isCompanyCandidate(value: string): boolean {
  const text = value.trim();
  if (text.length < 5 || text.length > 140) return false;
  const normalized = normalizePlain(text);
  if (/\b(dados|fiscais|produtos?|lista|preco|precos|relatorio|data|impressao|pagina|codigo|descricao|ncm|cest|icms|pis|cofins)\b/.test(normalized)) return false;
  if (/\b\d{2}[:/]\d{2}\b/.test(text)) return false;
  if (/^\d[\d\s.,/-]*$/.test(text)) return false;
  const words = normalized.split(' ').filter(Boolean);
  return words.length >= 2 && /[A-Za-zÀ-ÿ]/.test(text);
}

function companyScore(text: string, index: number): number {
  const letters = text.match(/[A-Za-zÀ-ÿ]/g) || [];
  const upper = text.match(/[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]/g) || [];
  const ratio = letters.length ? upper.length / letters.length : 0;
  let score = Math.min(text.length, 70) / 10 + Math.min(text.split(/\s+/).length, 8);
  if (ratio > 0.8) score += 15;
  if (/\b(LTDA|ME|EPP|COMERCIO|RESTAURANTE|MERCADO|HOTEL|BAR|LANCHONETE)\b/i.test(text)) score += 5;
  score += Math.max(0, 6 - index); // favorece o topo do cabeçalho
  return score;
}
