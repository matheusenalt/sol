import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { BatchRow } from '../core/types';
import { normalizeDigits, normalizeText } from '../core/normalize';
import { detectCompanyFromPdfTextLines, parseFiscalProductLine } from './pdf-row-parser';
import { isCervantesFiscalReport, parseCervantesFiscalPage } from './cervantes-pdf';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfToken = {
  text: string;
  x: number;
  y: number;
  width: number;
};

type PdfLine = {
  page: number;
  y: number;
  tokens: PdfToken[];
  text: string;
};

type HeaderColumns = {
  codeX?: number;
  descriptionX?: number;
  ncmX?: number;
  cestX?: number;
  cstX?: number;
  cClassTribX?: number;
  boundaries: number[];
};

export type PdfImportResult = {
  rows: BatchRow[];
  companyName: string;
};

const HEADER_WORDS = new Set([
  'codigo', 'cod', 'item', 'produto', 'descricao', 'mercadoria', 'ncm', 'ncm sh',
  'quantidade', 'qtd', 'valor', 'preco', 'unidade', 'un', 'cst', 'cclasstrib', 'cest',
  'estoque', 'custo', 'preco r', 'custo r',
]);

const COMPANY_BLACKLIST = [
  'lista de preco', 'lista de preços', 'lista de produtos', 'relatorio', 'relatório',
  'data de impressao', 'data de impressão', 'pagina', 'página', 'codigo', 'código',
  'descricao', 'descrição', 'produto', 'ncm', 'cst', 'cclasstrib', 'cest',
];

export async function readPdfBatch(file: File): Promise<PdfImportResult> {
  const buffer = await file.arrayBuffer();
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
  const document = await task.promise;
  const rows: BatchRow[] = [];
  let logicalRow = 0;
  let companyName = '';
  let cervantesReport = false;

  try {
    if (document.numPages > 200) {
      throw new Error('PDF acima do limite de 200 páginas. Divida o arquivo antes de importar.');
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = groupTokensIntoLines(content.items as unknown[], pageNumber);

      if (pageNumber === 1) {
        companyName = detectCompanyFromPdfTextLines(lines.map((line) => line.text)) || detectCompanyName(lines);
        cervantesReport = isCervantesFiscalReport(lines);
      }

      // O Cervantes omite os valores de NCM, mas mantém as posições das colunas.
      // Seu cabeçalho aparece apenas na primeira página.
      const pageRows = cervantesReport ? parseCervantesFiscalPage(lines, logicalRow) : rowsFromStructuredTable(lines, logicalRow);
      const fallbackRows = pageRows.length || cervantesReport ? [] : rowsFromFreeText(lines, logicalRow);
      const extracted = pageRows.length ? pageRows : fallbackRows;
      rows.push(...extracted);
      logicalRow += extracted.length;
      if (rows.length >= 10000) break;
    }
  } finally {
    await document.destroy();
  }

  if (!rows.length) {
    throw new Error(
      'O PDF foi aberto, mas não encontrei uma tabela de produtos legível. '
      + 'PDFs com Código + Descrição já podem ser importados mesmo sem NCM. '
      + 'Se o arquivo for apenas uma imagem escaneada, gere um PDF com texto pesquisável/OCR.',
    );
  }

  return {
    companyName,
    rows: rows.map((row, index) => ({ ...row, __row: index + 1 })),
  };
}

function groupTokensIntoLines(items: unknown[], page: number): PdfLine[] {
  const tokens: PdfToken[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw) || !('transform' in raw)) continue;
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown };
    const text = String(item.str ?? '').replace(/\s+/g, ' ').trim();
    const transform = Array.isArray(item.transform) ? item.transform : [];
    if (!text || transform.length < 6) continue;
    tokens.push({
      text,
      x: Number(transform[4] ?? 0),
      y: Number(transform[5] ?? 0),
      width: Number(item.width ?? 0),
    });
  }

  tokens.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const groups: PdfLine[] = [];

  for (const token of tokens) {
    let line = groups.find((candidate) => Math.abs(candidate.y - token.y) <= 2.4);
    if (!line) {
      line = { page, y: token.y, tokens: [], text: '' };
      groups.push(line);
    }
    line.tokens.push(token);
  }

  return groups
    .map((line) => {
      line.tokens.sort((a, b) => a.x - b.x);
      return { ...line, text: line.tokens.map((token) => token.text).join(' ').replace(/\s+/g, ' ').trim() };
    })
    .filter((line) => line.text);
}

function rowsFromStructuredTable(lines: PdfLine[], startIndex: number): BatchRow[] {
  const output: BatchRow[] = [];
  let columns: HeaderColumns | null = null;
  let rowIndex = startIndex;

  for (const line of lines) {
    const detected = detectHeader(line);
    if (detected) {
      columns = detected;
      continue;
    }

    // Relatórios como "Dados Fiscais de Produtos" frequentemente chegam do PDF.js
    // com Código + Produto no mesmo token. A estrutura textual é muito mais confiável
    // do que as coordenadas X: Código | Produto | UN | NCM | demais colunas.
    // Também funciona em páginas seguintes mesmo quando o cabeçalho não é repetido.
    const fiscalLine = parseFiscalProductLine(line.text);
    if (fiscalLine) {
      output.push({
        __row: rowIndex += 1,
        codigo: fiscalLine.codigo,
        descricao: fiscalLine.descricao,
        ncm: fiscalLine.ncm,
        cest: '',
        cst: '',
        cClassTrib: '',
      });
      continue;
    }

    if (!columns) continue;

    const code = columns.codeX === undefined ? '' : textAroundColumn(line.tokens, columns.codeX, columns.boundaries);
    let description = columns.descriptionX === undefined ? '' : textAroundColumn(line.tokens, columns.descriptionX, columns.boundaries);
    const ncmText = columns.ncmX === undefined ? '' : textAroundColumn(line.tokens, columns.ncmX, columns.boundaries);
    const ncm = findNcm(ncmText) || findNcm(line.text);

    if (!description && ncm) description = descriptionFromLine(line.text, ncm, code);
    description = cleanDescription(description, ncm, code);
    const cleanCode = cleanCodeValue(code, ncm);

    if (isHeaderLike(description) || isHeaderLike(cleanCode)) continue;
    if (!cleanCode && !description && !ncm) continue;
    if ((looksLikeFooterOrSection(description) || looksLikeSectionHeading(description)) && !cleanCode && !ncm) continue;

    const cest = columns.cestX === undefined ? '' : normalizeDigits(textAroundColumn(line.tokens, columns.cestX, columns.boundaries)).slice(0, 7);
    const cst = columns.cstX === undefined ? '' : normalizeDigits(textAroundColumn(line.tokens, columns.cstX, columns.boundaries)).slice(0, 3);
    const cClassTrib = columns.cClassTribX === undefined ? '' : normalizeDigits(textAroundColumn(line.tokens, columns.cClassTribX, columns.boundaries)).slice(0, 6);

    output.push({
      __row: rowIndex += 1,
      codigo: cleanCode,
      descricao: description,
      ncm,
      cest,
      cst,
      cClassTrib,
    });
  }

  return output;
}

function detectHeader(line: PdfLine): HeaderColumns | null {
  const normalized = line.tokens.map((token) => ({ token, normalized: normalizeText(token.text) }));
  const ncmToken = normalized.find(({ normalized: value }) => value === 'ncm' || value === 'ncm sh' || value.startsWith('ncm ') || /(^| )ncm( |$)/.test(value));
  const codeToken = normalized.find(({ normalized: value }) =>
    value === 'codigo' || value === 'cod' || value === 'cod produto' || value === 'item' || value === 'sku' || /(^| )(codigo|cod)( |$)/.test(value));
  const descriptionToken = normalized.find(({ normalized: value }) =>
    value === 'produto' || value === 'descricao' || value === 'nome' || value === 'mercadoria' || /(^| )(produto|descricao)( |$)/.test(value));
  const cestToken = normalized.find(({ normalized: value }) => value === 'cest' || value.startsWith('cest '));
  const cstToken = normalized.find(({ normalized: value }) =>
    value === 'cst' || value.startsWith('cst ibs') || value.startsWith('cst cbs'));
  const classToken = normalized.find(({ normalized: value }) =>
    value === 'cclasstrib' || value === 'cclass trib' || value === 'classe tributaria' || value.startsWith('cclasstrib '));

  // Para o motor cClassTrib aceitamos também listas simples de preço/produtos
  // sem NCM. Código + descrição entram na revisão para o NCM ser informado depois.
  if (!ncmToken && !(codeToken && descriptionToken)) return null;

  const boundaries = [...new Set(line.tokens.map((token) => token.x))].sort((a, b) => a - b);
  return {
    ncmX: ncmToken?.token.x,
    codeX: codeToken?.token.x,
    descriptionX: descriptionToken?.token.x,
    cestX: cestToken?.token.x,
    cstX: cstToken?.token.x,
    cClassTribX: classToken?.token.x,
    boundaries,
  };
}

function textAroundColumn(tokens: PdfToken[], x: number, boundaries: number[]): string {
  const xs = boundaries.length ? boundaries : [x];
  let index = xs.findIndex((value) => Math.abs(value - x) < 0.5);
  if (index < 0) index = xs.reduce((best, value, current) => Math.abs(value - x) < Math.abs(xs[best] - x) ? current : best, 0);
  const left = index > 0 ? (xs[index - 1] + x) / 2 : -Infinity;
  const right = index < xs.length - 1 ? (x + xs[index + 1]) / 2 : Infinity;

  return tokens
    .filter((token) => token.x >= left && token.x < right)
    .map((token) => token.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsFromFreeText(lines: PdfLine[], startIndex: number): BatchRow[] {
  const output: BatchRow[] = [];
  let rowIndex = startIndex;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const ncm = findNcm(line.text);
    if (!ncm) continue;

    const ncmPattern = ncmToFlexiblePattern(ncm);
    const parts = line.text.split(ncmPattern);
    const before = (parts[0] || '').trim();
    const after = (parts.slice(1).join(' ') || '').trim();
    const beforeTokens = before.split(/\s+/).filter(Boolean);

    let code = '';
    let description = before;
    if (beforeTokens.length >= 2 && looksLikeCode(beforeTokens[0])) {
      code = beforeTokens.shift() || '';
      description = beforeTokens.join(' ');
    }

    if (!description || description.length < 3) description = after;
    if ((!description || description.length < 3) && index > 0 && !findNcm(lines[index - 1].text)) {
      description = lines[index - 1].text;
    }

    description = cleanDescription(description, ncm, code);
    code = cleanCodeValue(code, ncm);
    if (isHeaderLike(description) || (!description && !code)) continue;

    output.push({
      __row: rowIndex += 1,
      codigo: code,
      descricao: description,
      ncm,
      cest: '',
      cst: '',
      cClassTrib: '',
    });
  }

  return output;
}

function detectCompanyName(lines: PdfLine[]): string {
  const headerIndex = lines.findIndex((line) => detectHeader(line) !== null);
  const limit = headerIndex >= 0 ? headerIndex : Math.min(lines.length, 15);
  const candidates = lines.slice(0, limit)
    .map((line) => line.text.replace(/\s+/g, ' ').trim())
    .filter((text) => isPossibleCompanyName(text))
    .map((text) => ({ text, score: companyNameScore(text) }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.text.slice(0, 140) || '';
}

function isPossibleCompanyName(text: string): boolean {
  if (text.length < 5 || text.length > 140) return false;
  const normalized = normalizeText(text);
  if (!normalized || COMPANY_BLACKLIST.some((blocked) => normalized.includes(normalizeText(blocked)))) return false;
  if (/^\d+$/.test(normalized.replace(/\s/g, ''))) return false;
  if (/\b\d{2}[:/]\d{2}/.test(text)) return false;
  if (/\b(cnpj|cpf|data|pagina|page)\b/i.test(text)) return false;
  const words = normalized.split(' ').filter(Boolean);
  return words.length >= 2 && /[A-Za-zÀ-ÿ]/.test(text);
}

function companyNameScore(text: string): number {
  const letters = text.match(/[A-Za-zÀ-ÿ]/g) || [];
  const upper = text.match(/[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]/g) || [];
  const uppercaseRatio = letters.length ? upper.length / letters.length : 0;
  const words = text.trim().split(/\s+/).length;
  let score = Math.min(text.length, 80) / 10 + Math.min(words, 8);
  if (uppercaseRatio > 0.75) score += 12;
  if (/\b(LTDA|ME|EPP|COMERCIO|RESTAURANTE|MERCADO|HOTEL|BAR|LANCHONETE)\b/i.test(text)) score += 5;
  return score;
}

function findNcm(text: string): string {
  const matches = text.match(/(?<!\d)(?:\d{4}[.\-\s]?\d{2}[.\-\s]?\d{2}|\d{8})(?!\d)/g) || [];
  for (const candidate of matches) {
    const digits = normalizeDigits(candidate);
    if (digits.length !== 8 || digits === '00000000') continue;
    const chapter = Number(digits.slice(0, 2));
    if (chapter >= 1 && chapter <= 97) return digits;
  }
  return '';
}

function ncmToFlexiblePattern(ncm: string): RegExp {
  if (!ncm) return /$^/;
  return new RegExp(`${ncm.slice(0, 4)}[.\\-\\s]?${ncm.slice(4, 6)}[.\\-\\s]?${ncm.slice(6, 8)}`);
}

function looksLikeCode(value: string): boolean {
  if (!value || value.length > 24) return false;
  const normalized = normalizeText(value);
  if (HEADER_WORDS.has(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value) && /\d/.test(value);
}

function cleanCodeValue(value: string, ncm: string): string {
  const clean = value.trim().replace(/^[:|;,-]+|[:|;,-]+$/g, '');
  return ncm && normalizeDigits(clean) === ncm ? '' : clean.slice(0, 80);
}

function descriptionFromLine(line: string, ncm: string, code: string): string {
  const withoutNcm = ncm ? line.replace(ncmToFlexiblePattern(ncm), ' ') : line;
  return code ? withoutNcm.replace(code, ' ') : withoutNcm;
}

function cleanDescription(value: string, ncm: string, code: string): string {
  let clean = value;
  if (ncm) clean = clean.replace(ncmToFlexiblePattern(ncm), ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  if (code && clean.startsWith(code)) clean = clean.slice(code.length).trim();
  return clean.replace(/^[-–—|:;,.]+|[-–—|:;,.]+$/g, '').slice(0, 500);
}

function isHeaderLike(value: string): boolean {
  const normalized = normalizeText(value);
  return !normalized || HEADER_WORDS.has(normalized) || normalized === 'ncm produto';
}

function looksLikeFooterOrSection(value: string): boolean {
  const normalized = normalizeText(value);
  return /^(total|subtotal|pagina|page|data de impressao)$/.test(normalized);
}

function looksLikeSectionHeading(value: string): boolean {
  const clean = value.trim();
  if (!clean || /\d/.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  const letters = clean.match(/[A-Za-zÀ-ÿ]/g) || [];
  const upper = clean.match(/[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]/g) || [];
  return words.length <= 4 && letters.length > 2 && upper.length / letters.length > 0.9;
}
