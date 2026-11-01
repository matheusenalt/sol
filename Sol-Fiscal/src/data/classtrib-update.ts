import * as XLSX from 'xlsx';
import type { ClassTribItem } from '../core/types';
import { normalizeDigits } from '../core/normalize';

const STORAGE_KEY = 'sol-fiscal:classtrib-official-override:v1';

export type ClassTribOverride = {
  schema: 1;
  sourceFile: string;
  importedAt: string;
  checksum: string;
  versionLabel: string;
  items: ClassTribItem[];
};

export function loadClassTribOverride(): ClassTribOverride | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClassTribOverride>;
    if (parsed.schema !== 1 || !Array.isArray(parsed.items) || parsed.items.length < 20) return null;
    const items = validateRows(parsed.items);
    if (items.length < 20) return null;
    return {
      schema: 1,
      sourceFile: String(parsed.sourceFile || 'Tabela importada'),
      importedAt: String(parsed.importedAt || ''),
      checksum: String(parsed.checksum || ''),
      versionLabel: String(parsed.versionLabel || 'Tabela oficial importada'),
      items,
    };
  } catch {
    return null;
  }
}

export function saveClassTribOverride(snapshot: ClassTribOverride): void {
  if (typeof localStorage === 'undefined') throw new Error('Armazenamento local indisponível.');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearClassTribOverride(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

export async function parseClassTribUpdateFile(file: File): Promise<ClassTribOverride> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = await sha256(bytes);
  const ext = file.name.toLowerCase().split('.').pop() || '';
  let rows: Record<string, unknown>[] = [];

  if (ext === 'json') {
    const decoded = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(decoded) as unknown;
    if (Array.isArray(parsed)) rows = parsed.filter(isRecord);
    else if (isRecord(parsed)) {
      const candidates = [parsed.items, parsed.data, parsed.rows, parsed.cClassTrib, parsed.classificacoes];
      const found = candidates.find(Array.isArray);
      if (Array.isArray(found)) rows = found.filter(isRecord);
    }
  } else {
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: false });
    const preferred = workbook.SheetNames
      .map((name: string) => ({ name, score: /cclass|class.*trib/i.test(name) ? 2 : /cst/i.test(name) ? 0 : 1 }))
      .sort((a: { name: string; score: number }, b: { name: string; score: number }) => b.score - a.score);
    for (const sheet of preferred) {
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheet.name], { defval: '', raw: false });
      if (looksLikeClassTrib(parsed)) rows.push(...parsed);
    }
  }

  const items = validateRows(rows);
  if (items.length < 20) {
    throw new Error(`A tabela importada gerou somente ${items.length} cClassTrib válido(s). Confira se o arquivo é a tabela completa de Classificação Tributária IBS/CBS.`);
  }

  return {
    schema: 1,
    sourceFile: file.name,
    importedAt: new Date().toISOString(),
    checksum,
    versionLabel: inferVersionLabel(file.name),
    items,
  };
}

function looksLikeClassTrib(rows: Record<string, unknown>[]): boolean {
  return rows.slice(0, 12).some((row) => {
    const keys = Object.keys(row).map(normalizeHeader);
    return keys.some((key) => key.includes('cclasstrib') || key.includes('classificacaotributaria'));
  });
}

function validateRows(rows: unknown[]): ClassTribItem[] {
  const unique = new Map<string, ClassTribItem>();
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const values = normalizedRecord(raw);
    const cClassTrib = normalizeDigits(first(values,
      'cclasstrib', 'codigocclasstrib', 'codigodaclassificacaotributaria', 'classificacaotributaria', 'codigoclassificacaotributaria')).slice(0, 6);
    let cst = normalizeDigits(first(values,
      'cst', 'cstibscbs', 'codigocst', 'codigodesituacaotributaria', 'situacaotributaria')).slice(0, 3);
    if (!cst && cClassTrib.length === 6) cst = cClassTrib.slice(0, 3);
    if (cst.length !== 3 || cClassTrib.length !== 6 || cClassTrib.slice(0, 3) !== cst) continue;

    const descricao = first(values,
      'descricaocclasstrib', 'descricaodaclassificacaotributaria', 'descricao', 'nomereduzido', 'nome', 'classificacao')
      || `CST ${cst} / cClassTrib ${cClassTrib}`;
    const fundamento = first(values,
      'lcredacao', 'redacaolc', 'fundamentolegal', 'fundamento', 'dispositivolegal', 'leicomplementar', 'lc2142025');
    const dfe = first(values, 'dfe', 'documentofiscal', 'documentosfiscais', 'modelodfe', 'modelosdfe');
    const inicioVigencia = first(values, 'iniciovigencia', 'datainiciovigencia', 'vigenciainicial', 'inicio');
    const fimVigencia = first(values, 'fimvigencia', 'datafimvigencia', 'vigenciafinal', 'fim');
    const key = `${cst}:${cClassTrib}`;
    if (!unique.has(key)) {
      unique.set(key, {
        cst,
        cClassTrib,
        descricao: String(descricao).trim(),
        fundamento: fundamento ? String(fundamento).trim() : undefined,
        dfe: dfe ? String(dfe).trim() : undefined,
        inicioVigencia: inicioVigencia ? String(inicioVigencia).trim() : undefined,
        fimVigencia: fimVigencia ? String(fimVigencia).trim() : undefined,
        fonte: 'Tabela oficial importada',
      });
    }
  }
  return [...unique.values()].sort((a, b) => a.cClassTrib.localeCompare(b.cClassTrib));
}

function normalizedRecord(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    if (!normalized) continue;
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (text && !out[normalized]) out[normalized] = text;
  }
  return out;
}

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function first(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) if (row[key]) return row[key];
  return '';
}

function inferVersionLabel(name: string): string {
  const explicit = name.match(/\bv(?:ers[aã]o)?[ ._-]*(\d+[._-]\d+(?:[._-]\d+)?)/i);
  const fallback = name.match(/(\d+[._-]\d+(?:[._-]\d+)?)/);
  const value = explicit?.[1] || fallback?.[1];
  return value ? `Importada • v${value.replace(/[_-]/g, '.')}` : 'Tabela oficial importada';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
