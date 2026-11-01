import { needsReview } from './review.js';
import { classifyProduct } from './engine.js';
import { formatNcm, normalizeDigits } from './normalize.js';
import type { BatchRow, BatchWorkItem, FiscalResult, SolCoreContext } from './types.js';

export type StoredBatchWorkItem = Omit<BatchWorkItem, 'result'> & {
  /**
   * Resultado congelado no momento em que o lote foi salvo.
   *
   * A partir desta revisão o resultado passa a fazer parte do snapshot do lote.
   * Isso impede que uma atualização futura do motor altere silenciosamente uma
   * empresa já trabalhada ou finalizada apenas porque ela foi reaberta.
   */
  result?: FiscalResult;
  /** Resultado da checagem unificada no momento de salvar para o backend. */
  pendingReview?: boolean;
};

export type LegacySnapshotMode = 'refresh' | 'freeze';

export function encodeBatchSnapshot(rows: BatchWorkItem[], ctx?: SolCoreContext): string {
  const stored: StoredBatchWorkItem[] = rows.map((item) => ({
    id: item.id,
    row: item.row,
    original: item.original,
    result: item.result,
    applied: item.applied,
    appliedBy: item.appliedBy,
    editedAt: item.editedAt,
    reviewDecision: item.reviewDecision,
    cestDecision: item.cestDecision,
    pendingReview: ctx ? needsReview(ctx, item) : item.result.status === 'revisão',
  }));
  return JSON.stringify(stored);
}

export function decodeBatchSnapshot(
  ctx: SolCoreContext,
  payload: string,
  legacyMode: LegacySnapshotMode = 'refresh',
): BatchWorkItem[] {
  const stored = JSON.parse(payload || '[]') as StoredBatchWorkItem[];
  if (!Array.isArray(stored)) return [];

  return stored.map((item): BatchWorkItem => {
    if (item.result) return { ...item, result: item.result };
    if (legacyMode === 'freeze') return { ...item, result: buildLegacyFrozenResult(item.row) };

    const result = classifyProduct(ctx, item.row);
    const row = result.status === 'validado' && result.resolved.ncm && result.resolved.cClassTrib
      ? {
          ...item.row,
          ncm: result.resolved.ncm.codigo,
          cst: result.resolved.cClassTrib.cst,
          cClassTrib: result.resolved.cClassTrib.codigo,
        }
      : { ...item.row };
    return { ...item, row, result };
  });
}

/**
 * Reconstrói um resultado mínimo para lotes antigos que foram finalizados antes
 * de o snapshot do motor ser persistido. O valor histórico do lote é preservado
 * em vez de ser recalculado com uma base fiscal mais nova.
 */
export function buildLegacyFrozenResult(row: BatchRow): FiscalResult {
  const ncm = normalizeDigits(row.ncm);
  const cst = normalizeDigits(row.cst).slice(0, 3);
  const cClassTrib = normalizeDigits(row.cClassTrib).slice(0, 6);
  const ncmComplete = ncm.length === 8 && ncm !== '00000000';
  const fiscalComplete = cst.length === 3 && cClassTrib.length === 6;
  const prefixMatches = !fiscalComplete || cClassTrib.slice(0, 3) === cst;
  const complete = ncmComplete && fiscalComplete;
  const warnings: string[] = [
    'Snapshot legado preservado sem recalcular pela base fiscal atual.',
  ];
  if (fiscalComplete && !prefixMatches) {
    warnings.push('O cClassTrib legado não possui o mesmo prefixo do CST. Revise ao reabrir para edição.');
  }

  return {
    engineVersion: 'Sol Core • snapshot legado',
    status: complete ? 'validado' : 'revisão',
    confidence: 'indeterminada',
    input: { ...row, ncm, cst, cClassTrib },
    resolved: {
      ncm: ncmComplete ? {
        codigo: ncm,
        codigoFormatado: formatNcm(ncm),
        validated: true,
      } : null,
      cest: null,
      cClassTrib: fiscalComplete ? {
        codigo: cClassTrib,
        cst,
        descricao: 'Classificação preservada do lote legado',
        fundamento: 'Resultado histórico preservado; não foi recalculado pela base fiscal instalada atualmente.',
        validated: true,
      } : null,
    },
    candidates: { ncm: [], cest: [], cClassTrib: [] },
    warnings,
    decision: complete
      ? 'Classificação histórica preservada exatamente como estava salva no lote.'
      : 'Lote legado incompleto; requer revisão antes de nova finalização.',
    sources: { snapshot: 'legado' },
  };
}

export function isBatchSnapshotComplete(rows: BatchWorkItem[], ctx?: SolCoreContext): boolean {
  return rows.length > 0 && rows.every((item) => {
    const ncm = normalizeDigits(item.row.ncm);
    const cst = normalizeDigits(item.row.cst).slice(0, 3);
    const cClassTrib = normalizeDigits(item.row.cClassTrib).slice(0, 6);
    return (!ctx || !needsReview(ctx, item))
      && ncm.length === 8
      && ncm !== '00000000'
      && cst.length === 3
      && cClassTrib.length === 6
      && cClassTrib.slice(0, 3) === cst;
  });
}
