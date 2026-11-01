import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';
import { coreContext } from './loaders';
import { normalizeDigits, normalizeText } from '../core/normalize';
import type { NcmItem } from '../core/types';

const OFFICIAL_URL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
const LOCAL_KEY = 'sol-fiscal:ncm-descricoes:v1';
const MIN_ROWS = 8000;

function isTauri() { return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__); }

export type NcmReferenceStatus = { count: number; source: string; updatedAt: string };
let active: NcmReferenceStatus | null = null;
let loadedOnce = false;

export function activeNcmDescriptionStatus(): NcmReferenceStatus | null { return active; }

function normalObject(row: unknown): Record<string, unknown> | null {
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

function findRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(normalObject).filter((v): v is Record<string, unknown> => v !== null);
  const record = normalObject(data);
  if (!record) return [];
  const nested = record.Nomenclaturas ?? record.nomenclaturas ?? record.items ?? record.data;
  return Array.isArray(nested) ? nested.map(normalObject).filter((v): v is Record<string, unknown> => v !== null) : [];
}

function readField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const found = Object.entries(row).find(([name]) => normalizeText(name).replace(/ /g, '') === key.toLowerCase());
    if (found && found[1] != null) return String(found[1]).trim();
  }
  return '';
}

export function parseOfficialNcmReference(data: unknown): NcmItem[] {
  const raw = findRows(data);
  const entries = new Map<string, string>();
  for (const row of raw) {
    const code = normalizeDigits(readField(row, 'Codigo', 'Código', 'codigo', 'code'));
    const desc = readField(row, 'Descricao', 'Descrição', 'descricao', 'description')
      .replace(/^[\s\-–—.:]+/, '').replace(/\s+/g, ' ').trim();
    if (![2, 4, 5, 6, 7, 8].includes(code.length) || !desc) continue;
    if (!entries.has(code)) entries.set(code, desc);
  }
  const result: NcmItem[] = [];
  for (const [codigo, descricao] of entries) {
    if (codigo.length !== 8) continue;
    // Indentação fiscal como "Outros" não define o produto isoladamente.
    // Acrescentamos os títulos superiores ao índice de busca.
    const parents = [2, 4, 5, 6, 7].map((size) => entries.get(codigo.slice(0, size))).filter(Boolean) as string[];
    const pieces = [...parents, descricao].filter((text, i, array) => array.indexOf(text) === i);
    result.push({ codigo, descricao: pieces.join(' • ') });
  }
  if (result.length < MIN_ROWS || result.length > 20000) {
    throw new Error(`Base de descrições NCM incompleta (${result.length}). A base válida anterior foi mantida.`);
  }
  return result;
}

function activate(data: unknown, source: string): NcmReferenceStatus {
  const entries = parseOfficialNcmReference(data);
  // Mantém validação fiscal da base instalada independente das descrições.
  coreContext.ncm = entries;
  const status = { count: entries.length, source, updatedAt: new Date().toISOString() };
  active = status;
  coreContext.baseVersions = { ...coreContext.baseVersions, ncm: `${source} • ${status.updatedAt.slice(0, 10)}` };
  return status;
}

export async function loadNcmDescriptions(downloadIfMissing = false): Promise<NcmReferenceStatus | null> {
  if (active) return active;
  if (loadedOnce && !downloadIfMissing) return null;
  loadedOnce = true;
  try {
    if (isTauri()) {
      const data = await invoke<unknown | null>('read_ncm_reference');
      if (data) return activate(data, 'Cache local da tabela oficial');
    } else {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return activate(JSON.parse(raw), 'Tabela importada localmente');
    }
  } catch { /* Uma base inconsistente não deve impedir importar os produtos. */ }
  if (downloadIfMissing) return synchronizeNcmDescriptions();
  return null;
}

export async function synchronizeNcmDescriptions(): Promise<NcmReferenceStatus> {
  if (isTauri()) {
    await invoke('sync_ncm_reference');
    const data = await invoke<unknown>('read_ncm_reference');
    return activate(data, 'Receita Federal / Classif');
  }
  const response = await fetch(OFFICIAL_URL);
  if (!response.ok) throw new Error(`Classif respondeu HTTP ${response.status}.`);
  const data: unknown = await response.json();
  const parsed = parseOfficialNcmReference(data);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }
  catch { throw new Error(`Base consultada com ${parsed.length} NCMs, mas não coube no armazenamento local.`); }
  return activate(data, 'Receita Federal / Classif');
}

export async function importNcmDescriptions(file: File): Promise<NcmReferenceStatus> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Limite de 25 MB para a base NCM.');
  const ext = file.name.toLowerCase().split('.').pop();
  let data: unknown;
  if (ext === 'json') data = JSON.parse(await file.text());
  else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
    const sheet = book.Sheets[book.SheetNames[0]];
    data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false });
  } else throw new Error('Envie a tabela NCM oficial em JSON, XLSX ou CSV.');
  // Validação ANTES de gravar, para nunca substituir um snapshot válido por parcial.
  parseOfficialNcmReference(data);
  if (isTauri()) await invoke('save_ncm_reference', { data });
  else localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  return activate(data, `Arquivo ${file.name}`);
}
