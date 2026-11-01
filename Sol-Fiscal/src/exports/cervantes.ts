import type { BatchWorkItem } from '../core/types';
export type CervantesRow = {
  Código: string;
  Produto: string;
  NCM: string;
  cClassTrib: string;
};

export function toCervantesRows(items: BatchWorkItem[]): CervantesRow[] {
  return items.map((item) => ({
    Código: item.row.codigo || '',
    Produto: item.row.descricao || '',
    NCM: digits(item.result.resolved.ncm?.codigo || ''),
    cClassTrib: item.result.status === 'validado'
      ? digits(item.result.resolved.cClassTrib?.codigo || item.row.cClassTrib || '')
      : '',
  }));
}

function digits(value: string): string { return String(value || '').replace(/\D/g, ''); }
