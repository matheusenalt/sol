import * as XLSX from 'xlsx';
import type { BatchRow } from '../core/types';
import { normalizeDigits, normalizeText } from '../core/normalize';
import { readPdfBatch } from './pdf';

const MAX_IMPORT_BYTES = 35 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'csv', 'txt', 'pdf']);

export type BatchImportResult = {
  rows: BatchRow[];
  companyName: string;
  duplicatesRemoved: number;
  sourceName: string;
};

const FIELD_ALIASES: Record<string, string[]> = {
  codigo: [
    'codigo', 'código', 'cod', 'cod produto', 'codigo produto', 'código produto',
    'id', 'sku', 'item', 'cod item', 'referencia', 'referência',
  ],
  descricao: [
    'produto', 'descricao', 'descrição', 'nome', 'nome produto', 'descricao produto',
    'descrição produto', 'mercadoria', 'item descricao', 'item descrição',
  ],
  ncm: ['ncm', 'ncm sh', 'ncm/sh', 'codigo ncm', 'código ncm', 'ncm produto'],
  cest: ['cest', 'codigo cest', 'código cest', 'cest produto'],
  cst: ['cst', 'cst ibs cbs', 'cst ibs/cbs', 'cst_ibs_cbs', 'ibs cbs cst', 'cst novo'],
  cClassTrib: [
    'cclasstrib', 'cclass trib', 'cclass_trib', 'class trib', 'classe tributaria',
    'classe tributária', 'codigo classtrib', 'código classtrib',
  ],
};

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeHeader)]),
) as Record<keyof typeof FIELD_ALIASES, string[]>;

export async function readBatchFile(file: File): Promise<BatchImportResult> {
  const extension = file.name.toLowerCase().split('.').pop() || '';

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('Formato não suportado. Use PDF, XLSX, XLS, CSV ou TXT.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('Arquivo muito grande. Limite desta versão: 35 MB.');
  }
  await validateFileSignature(file, extension);

  let rows: BatchRow[];
  let companyName = '';

  if (extension === 'pdf') {
    const parsed = await readPdfBatch(file);
    rows = parsed.rows;
    companyName = parsed.companyName;
  } else {
    const workbook = extension === 'xlsx' || extension === 'xls'
      ? XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false })
      : XLSX.read(await file.text(), { type: 'string', raw: false });

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('O arquivo não possui uma planilha legível.');

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });

    const parsed = rowsFromMatrix(matrix);
    rows = parsed.rows;
    companyName = parsed.companyName;
  }

  if (!rows.length) {
    throw new Error(
      'Não encontrei produtos para analisar. Informe ao menos Código/Produto e, quando disponível, NCM. '
      + 'Itens sem NCM entram na revisão para correção.',
    );
  }

  const deduped = dedupeBatchRows(rows);
  const fallbackCompany = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return {
    rows: deduped.rows.map((row, index) => ({ ...row, __row: index + 1 })),
    companyName: companyName || fallbackCompany || 'Empresa não identificada',
    duplicatesRemoved: deduped.duplicatesRemoved,
    sourceName: file.name,
  };
}

function rowsFromMatrix(matrix: unknown[][]): { rows: BatchRow[]; companyName: string } {
  if (!matrix.length) return { rows: [], companyName: '' };
  const headerIndex = findHeaderRow(matrix);
  const header = (matrix[headerIndex] || []).map((value) => String(value ?? ''));
  const fieldMap = buildFieldMap(header);

  // NCM deixou de ser obrigatório: listas de produtos podem entrar sem ele e
  // seguir para revisão, onde o técnico informa/corrige o NCM.
  if (fieldMap.ncm === undefined && fieldMap.codigo === undefined && fieldMap.descricao === undefined) {
    return { rows: [], companyName: detectCompanyFromMatrix(matrix, headerIndex) };
  }

  const output: BatchRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const source = matrix[index] || [];
    if (source.every((value) => !String(value ?? '').trim())) continue;

    const row: BatchRow = {
      __row: index + 1,
      codigo: valueAt(source, fieldMap.codigo),
      descricao: valueAt(source, fieldMap.descricao),
      ncm: valueAt(source, fieldMap.ncm),
      cest: valueAt(source, fieldMap.cest),
      cst: valueAt(source, fieldMap.cst),
      cClassTrib: valueAt(source, fieldMap.cClassTrib),
    };

    if (!row.ncm && !row.codigo && !row.descricao) continue;
    output.push(row);
  }

  return { rows: output, companyName: detectCompanyFromMatrix(matrix, headerIndex) };
}

function findHeaderRow(matrix: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 30);

  for (let index = 0; index < limit; index += 1) {
    const values = (matrix[index] || []).map((value) => normalizeHeader(value));
    let score = 0;
    for (const value of values) {
      if (!value) continue;
      if (NORMALIZED_ALIASES.ncm.includes(value)) score += 6;
      if (NORMALIZED_ALIASES.descricao.includes(value)) score += 4;
      if (NORMALIZED_ALIASES.codigo.includes(value)) score += 3;
      if (NORMALIZED_ALIASES.cest.includes(value)) score += 1;
      if (NORMALIZED_ALIASES.cst.includes(value)) score += 1;
      if (NORMALIZED_ALIASES.cClassTrib.includes(value)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function buildFieldMap(header: string[]) {
  const normalized = header.map(normalizeHeader);
  const find = (field: keyof typeof NORMALIZED_ALIASES) => {
    const aliases = NORMALIZED_ALIASES[field];
    const exact = normalized.findIndex((value) => aliases.includes(value));
    if (exact >= 0) return exact;
    const loose = normalized.findIndex((value) => aliases.some((alias) => value === alias || value.startsWith(`${alias} `)));
    return loose >= 0 ? loose : undefined;
  };

  return {
    codigo: find('codigo'),
    descricao: find('descricao'),
    ncm: find('ncm'),
    cest: find('cest'),
    cst: find('cst'),
    cClassTrib: find('cClassTrib'),
  };
}

function detectCompanyFromMatrix(matrix: unknown[][], headerIndex: number): string {
  const candidates = matrix.slice(0, Math.max(0, headerIndex)).flatMap((row) => {
    const text = row.map((value) => String(value ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return text ? [text] : [];
  });
  return candidates.find(isCompanyCandidate)?.slice(0, 140) || '';
}

function isCompanyCandidate(value: string): boolean {
  if (value.length < 5 || value.length > 140) return false;
  const normalized = normalizeText(value);
  if (!normalized || /\b(lista|relatorio|relatório|data|pagina|página|codigo|descricao|produto|ncm|cst|cclasstrib)\b/.test(normalized)) return false;
  return normalized.split(' ').filter(Boolean).length >= 2 && /[A-Za-zÀ-ÿ]/.test(value);
}

function dedupeBatchRows(rows: BatchRow[]): { rows: BatchRow[]; duplicatesRemoved: number } {
  const seenCodes = new Set<string>();
  const seenProducts = new Set<string>();
  const output: BatchRow[] = [];
  let duplicatesRemoved = 0;

  for (const row of rows) {
    const code = normalizeText(row.codigo || '');
    const description = normalizeText(row.descricao || '');
    const ncm = normalizeDigits(row.ncm);
    const productKey = description ? `${description}|${ncm}` : '';

    // Repetido por código OU pela mesma descrição/NCM entra uma única vez no lote.
    const duplicate = code ? seenCodes.has(code) : Boolean(productKey && seenProducts.has(productKey));
    if (duplicate) {
      duplicatesRemoved += 1;
      continue;
    }
    if (!code && !description && !ncm) continue;
    if (code) seenCodes.add(code);
    if (productKey) seenProducts.add(productKey);
    output.push(row);
  }

  return { rows: output, duplicatesRemoved };
}

function valueAt(row: unknown[], index?: number): string {
  if (index === undefined) return '';
  return String(row[index] ?? '').trim();
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function validateFileSignature(file: File, extension: string): Promise<void> {
  if (!['pdf', 'xlsx', 'xls'].includes(extension)) return;
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);

  if (extension === 'pdf' && !starts(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    throw new Error('O arquivo possui extensão PDF, mas não contém uma assinatura PDF válida.');
  }
  if (extension === 'xlsx' && !starts(0x50, 0x4b)) {
    throw new Error('O arquivo possui extensão XLSX, mas não contém uma estrutura XLSX/ZIP válida.');
  }
  if (extension === 'xls' && !starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
    throw new Error('O arquivo possui extensão XLS, mas não contém uma estrutura XLS válida.');
  }
}
