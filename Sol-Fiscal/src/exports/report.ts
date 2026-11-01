import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { BatchWorkItem } from '../core/types';
import { formatNcm, normalizeDigits } from '../core/normalize';
import { toCervantesRows, type CervantesRow } from './cervantes';
import { toFiscalCompleteRows } from './fiscal-rows';
import { needsReview, reviewIssueLabels } from '../core/review';
import { coreContext } from '../data/loaders';

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

type AuditRow = CervantesRow & {
  Empresa: string;
  Linha: number;
  CEST: string;
  NCM_sugerido: string;
  Descricao_NCM_sugerido: string;
  CST: string;
  Confiança: string;
  Status: string;
  Origem: string;
  Motor: string;
  BaseFiscal: string;
  NCM_informado: string;
  CEST_informado: string;
  CST_informado: string;
  cClassTrib_informado: string;
  Pendencias: string;
  Observação: string;
};

function toAuditRows(items: BatchWorkItem[], companyName: string): AuditRow[] {
  return items.map((item) => ({
    ...toCervantesRows([item])[0],
    Empresa: companyName || '',
    Linha: item.row.__row,
    CEST: normalizeDigits(item.row.cest || ''),
    NCM_sugerido: !item.result.resolved.ncm ? (item.result.candidates.ncm[0]?.code || '') : '',
    Descricao_NCM_sugerido: !item.result.resolved.ncm ? (item.result.candidates.ncm[0]?.label || '') : '',
    CST: item.result.resolved.cClassTrib?.cst || '',
    Confiança: item.result.confidence,
    Status: needsReview(coreContext, item) ? 'revisão' : 'resolvido',
    Origem: item.appliedBy === 'manual' ? 'Manual' : item.result.status === 'validado' ? 'Motor' : 'Revisão',
    Motor: item.result.engineVersion || '—',
    BaseFiscal: itemFiscalBase(item),
    NCM_informado: normalizeDigits(item.row.ncm),
    CEST_informado: normalizeDigits(item.row.cest),
    CST_informado: normalizeDigits(item.row.cst),
    cClassTrib_informado: normalizeDigits(item.row.cClassTrib),
    Pendencias: reviewIssueLabels(coreContext, item).join(' / '),
    Observação: item.result.warnings.join(' | ') || item.result.decision,
  }));
}

export async function exportBatch(items: BatchWorkItem[], format: ExportFormat, sourceName = 'analise', companyName = ''): Promise<string | null> {
  if (!items.length) throw new Error('Não há dados para exportar.');

  const identity = sanitizeName(companyName || sourceName.replace(/\.[^.]+$/, '') || 'analise');
  const filename = `${identity}-Sol-Fiscal.${format}`;
  const cervantesRows = toCervantesRows(items);
  const auditRows = toAuditRows(items, companyName);
  const pending = items.filter((item) => needsReview(coreContext, item)).length;
  const fiscalBase = batchFiscalBase(items);

  if (format === 'xlsx') {
    const cervantesSheet = XLSX.utils.json_to_sheet(cervantesRows);
    cervantesSheet['!cols'] = [{ wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 14 }];

    const auditSheet = XLSX.utils.json_to_sheet(auditRows);
    auditSheet['!cols'] = [{ wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 38 }, { wch: 56 }];

    const info = XLSX.utils.aoa_to_sheet([
      ['Empresa', companyName || 'Não identificada'],
      ['Arquivo de origem', sourceName || 'Lote local'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      ['Total', items.length],
      ['Resolvidos', items.length - pending],
      ['Revisão', pending],
      ['Base fiscal do snapshot', fiscalBase],
      ['Observação', pending ? 'Campos confirmados separados de valores informados pendentes. Não importe dados pendentes como homologados.' : 'Todos os itens estão resolvidos.'],
    ]);
    info['!cols'] = [{ wch: 22 }, { wch: 75 }];

    const workbook = XLSX.utils.book_new();
    // Primeira aba é a operacional para importação/uso no Cervantes.
    XLSX.utils.book_append_sheet(workbook, cervantesSheet, 'Cervantes');
    const fullFiscalRows = toFiscalCompleteRows(coreContext, items);
    const fullFiscalSheet = XLSX.utils.json_to_sheet(fullFiscalRows);
    fullFiscalSheet['!cols'] = Object.keys(fullFiscalRows[0] || {}).map((key) => ({ wch: /Produto/.test(key) ? 46 : /Observacao|Pendencias/.test(key) ? 62 : 24 }));
    XLSX.utils.book_append_sheet(workbook, fullFiscalSheet, 'Fiscal Completo');
    XLSX.utils.book_append_sheet(workbook, auditSheet, 'Auditoria Sol');
    const suggestions = items.flatMap((item) => item.result.resolved.ncm ? [] : item.result.candidates.ncm.slice(0, 5).map((candidate, index) => ({
      Código: item.row.codigo || '', Produto: item.row.descricao || '', Ordem: index + 1,
      NCM_sugerido: candidate.code, Descricao_fiscal: candidate.label,
      Confiança: candidate.confidence, Motivo: candidate.reason,
      Status: 'PENDENTE — confirmar',
    })));
    if (suggestions.length) {
      const suggestionSheet = XLSX.utils.json_to_sheet(suggestions);
      suggestionSheet['!cols'] = [{ wch: 14 }, { wch: 46 }, { wch: 8 }, { wch: 14 }, { wch: 64 }, { wch: 13 }, { wch: 65 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(workbook, suggestionSheet, 'Sugestões NCM');
    }
    XLSX.utils.book_append_sheet(workbook, info, 'Informações');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    return saveBytes(filename, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', format);
  }

  if (format === 'csv') {
    const safeRows = toFiscalCompleteRows(coreContext, items).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, neutralizeFormula(String(value))])));
    const sheet = XLSX.utils.json_to_sheet(safeRows);
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
    return saveBytes(filename, new TextEncoder().encode(`\uFEFF${csv}`), 'text/csv;charset=utf-8', format);
  }

  const pdf = buildPdf(items, cervantesRows, sourceName, companyName);
  return saveBytes(filename, new Uint8Array(pdf.output('arraybuffer')), 'application/pdf', format);
}

function buildPdf(items: BatchWorkItem[], rows: CervantesRow[], sourceName: string, companyName: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const validado = items.filter((item) => !needsReview(coreContext, item)).length;
  const revisao = items.length - validado;
  doc.setFontSize(16); doc.text('Sol Fiscal — Relatório de análise fiscal', 12, 14);
  doc.setFontSize(10); doc.text(`Empresa: ${truncate(companyName || 'Não identificada', 80)}`, 12, 20);
  doc.setFontSize(8.5); doc.text(`Origem: ${sourceName || 'análise local'}`, 12, 25);
  doc.text(`Base fiscal: ${truncate(batchFiscalBase(items), 110)}`, 12, 30);
  doc.text(`Total: ${items.length} | Resolvidos: ${validado} | Revisão: ${revisao}`, 12, 35);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 12, 40);

  const headers = ['Código', 'Produto', 'NCM', 'CEST', 'CST', 'cClassTrib', 'Status'];
  const x = [12, 38, 154, 184, 208, 228, 258];
  let y = 49;
  doc.setFontSize(8); headers.forEach((header, index) => doc.text(header, x[index], y));
  y += 4; doc.line(12, y - 2.5, 285, y - 2.5);

  rows.slice(0, 1500).forEach((row, index) => {
    if (y > 194) { doc.addPage('a4', 'landscape'); y = 14; headers.forEach((header, column) => doc.text(header, x[column], y)); y += 5; }
    const status = items[index] && !needsReview(coreContext, items[index]) ? 'resolvido' : 'revisão';
    const item = items[index];
    const values = [truncate(row.Código, 12), truncate(row.Produto || row.Código, 48), row.NCM ? formatNcm(row.NCM) : '—', normalizeDigits(item?.row.cest || '') || '—', item?.result.resolved.cClassTrib?.cst || (item?.row.cst ? '*' + normalizeDigits(item.row.cst) : '—'), row.cClassTrib || (item?.row.cClassTrib ? '*' + normalizeDigits(item.row.cClassTrib) : '—'), status];
    values.forEach((value, column) => doc.text(String(value || '—'), x[column], y));
    y += 4.2;
  });
  doc.setFontSize(7); doc.text('* Valores manuais ainda pendentes de validação fiscal.', 12, 204);
  return doc;
}

export function itemFiscalBase(item: BatchWorkItem): string {
  const sources = item.result.sources || {};
  return sources.cClassTrib
    || sources.fiscalCatalog
    || (sources.snapshot ? `snapshot ${sources.snapshot}` : '')
    || item.result.engineVersion
    || 'base não registrada';
}

export function batchFiscalBase(items: BatchWorkItem[]): string {
  const values = [...new Set(items.map(itemFiscalBase).filter(Boolean))];
  if (!values.length) return 'base não registrada';
  if (values.length === 1) return values[0];
  return values.join(' | ');
}

async function saveBytes(filename: string, bytes: Uint8Array, mime: string, format: ExportFormat): Promise<string | null> {
  if (isTauri()) {
    const selected = await save({
      defaultPath: filename,
      filters: [{ name: format === 'xlsx' ? 'Excel' : format.toUpperCase(), extensions: [format] }],
      canCreateDirectories: true,
    });
    if (!selected) return null;
    const path = selected.toLowerCase().endsWith(`.${format}`) ? selected : `${selected}.${format}`;
    return invoke<string>('save_export_file_to_path', { path, base64: bytesToBase64(bytes) });
  }

  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  return filename;
}

function isTauri() { return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__); }
function bytesToBase64(bytes: Uint8Array): string { let binary = ''; const chunkSize = 0x8000; for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize)); return btoa(binary); }
function neutralizeFormula(value: string): string { return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value; }
function sanitizeName(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '').slice(0, 80) || 'analise'; }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`; }
export function currentNcm(item: BatchWorkItem): string { return normalizeDigits(item.result.resolved.ncm?.codigo || item.row.ncm || ''); }
