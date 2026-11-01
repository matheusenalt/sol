import { classifyProduct } from './engine.js';
import { normalizeDigits } from './normalize.js';
import { isCestCompatible } from './cest.js';
import type { BatchRow, BatchWorkItem, FiscalInput, SolCoreContext } from './types.js';

export function buildBatchWorkItem(
  ctx: SolCoreContext,
  row: BatchRow,
  id: string,
  original: BatchRow = { ...row },
): BatchWorkItem {
  const result = classifyProduct(ctx, row);
  const resolved = applyResolvedValues(row, result);
  const motorChanged = hasFiscalChange(original, resolved);

  return {
    id,
    original: { ...original },
    row: resolved,
    result,
    applied: motorChanged,
    appliedBy: motorChanged ? 'motor' : undefined,
    editedAt: motorChanged ? new Date().toISOString() : undefined,
  };
}

export function refreshBatchWorkItem(ctx: SolCoreContext, item: BatchWorkItem): BatchWorkItem {
  const input: BatchRow = {
    ...item.row,
    manualConfirmed: item.row.manualConfirmed,
  };
  const result = classifyProduct(ctx, input);
  const resolved = applyResolvedValues(input, result);
  const motorChanged = hasFiscalChange(item.original, resolved);
  return {
    ...item,
    row: resolved,
    result,
    applied: item.applied || motorChanged,
    appliedBy: item.appliedBy || (motorChanged ? 'motor' : undefined),
  };
}

export function applyManualFiscalEdit(
  ctx: SolCoreContext,
  item: BatchWorkItem,
  edit: Pick<FiscalInput, 'ncm' | 'cst' | 'cClassTrib'>,
): BatchWorkItem {
  const nextInput: BatchRow = {
    ...item.row,
    ncm: normalizeDigits(edit.ncm),
    cst: normalizeDigits(edit.cst).slice(0, 3),
    cClassTrib: normalizeDigits(edit.cClassTrib).slice(0, 6),
    manualConfirmed: Boolean(normalizeDigits(edit.cst) && normalizeDigits(edit.cClassTrib)),
  };
  const result = classifyProduct(ctx, nextInput);
  const resolved = applyResolvedValues(nextInput, result);
  return {
    ...item,
    row: resolved,
    result,
    applied: true,
    appliedBy: 'manual',
    editedAt: new Date().toISOString(),
    reviewDecision: result.status === 'validado' ? 'aceito' : undefined,
    cestDecision: normalizeDigits(edit.ncm) !== normalizeDigits(item.row.ncm) ? undefined : item.cestDecision,
  };
}

function applyResolvedValues(row: BatchRow, result: ReturnType<typeof classifyProduct>): BatchRow {
  if (result.status !== 'validado' || !result.resolved.ncm || !result.resolved.cClassTrib) {
    return { ...row };
  }
  return {
    ...row,
    ncm: result.resolved.ncm.codigo,
    cst: result.resolved.cClassTrib.cst,
    cClassTrib: result.resolved.cClassTrib.codigo,
  };
}

function hasFiscalChange(before: BatchRow, after: BatchRow): boolean {
  return normalizeDigits(before.ncm) !== normalizeDigits(after.ncm)
    || normalizeDigits(before.cst) !== normalizeDigits(after.cst)
    || normalizeDigits(before.cClassTrib) !== normalizeDigits(after.cClassTrib);
}

/** Decisão de CEST só pode ser dada após validar o NCM. */
export function applyCestReviewDecision(ctx: SolCoreContext, item: BatchWorkItem, cest: string | null): BatchWorkItem {
  if (!item.result.resolved.ncm) throw new Error('Confirme o NCM antes de revisar CEST.');
  const code = normalizeDigits(cest || '');
  if (code && !isCestCompatible(ctx.cest, item.row.ncm || '', code)) throw new Error('CEST não compatível com o NCM na base local. Revise a mercadoria.');
  return {
    ...item,
    row: { ...item.row, cest: code },
    cestDecision: code ? undefined : 'nao-aplicavel',
    applied: true,
    appliedBy: 'manual',
    editedAt: new Date().toISOString(),
    reviewDecision: item.result.status === 'validado' ? 'aceito' : undefined,
  };
}

/** Ao corrigir NCM, uma classificação humana anterior pode ser mantida com nova
 * confirmação explícita; nunca manter automaticamente classificação do motor. */
export function applyReviewedNcmCorrection(
  ctx: SolCoreContext, item: BatchWorkItem, ncm: string, preserveManualClassification = false,
): BatchWorkItem {
  const keep = preserveManualClassification && item.row.manualConfirmed === true;
  return applyManualFiscalEdit(ctx, item, {
    ncm,
    cst: keep ? item.row.cst : '',
    cClassTrib: keep ? item.row.cClassTrib : '',
  });
}
