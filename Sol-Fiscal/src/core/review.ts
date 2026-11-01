import { findCestForNcm, isCestCompatible } from './cest.js';
import { normalizeDigits } from './normalize.js';
import type { BatchWorkItem, SolCoreContext } from './types.js';

/** Uma única regra para fila, exportação e finalização. CEST não implica ICMS-ST. */
export type ReviewIssue = 'ncm' | 'cest' | 'cst-cclasstrib';

export function reviewIssues(ctx: SolCoreContext, item: BatchWorkItem): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const ncm = normalizeDigits(item.row.ncm);
  const ncmOk = Boolean(item.result.resolved.ncm && item.result.resolved.ncm.codigo === ncm);
  if (!ncmOk) issues.push('ncm');
  if (item.result.status !== 'validado' || !item.result.resolved.cClassTrib) issues.push('cst-cclasstrib');
  const cest = normalizeDigits(item.row.cest);
  if (cest) {
    if (!ncmOk || !isCestCompatible(ctx.cest, ncm, cest)) issues.push('cest');
  } else if (ncmOk && item.cestDecision !== 'nao-aplicavel' && findCestForNcm(ctx.cest, ncm, item.row.descricao || '').length > 0) {
    // Só exige revisão quando há algum CEST candidato. O técnico pode marcar
    // explicitamente não aplicável; vinculação por NCM sozinha não prova ST.
    issues.push('cest');
  }
  return issues;
}

export function needsReview(ctx: SolCoreContext, item: BatchWorkItem): boolean {
  return reviewIssues(ctx, item).length > 0;
}

export function reviewIssueLabels(ctx: SolCoreContext, item: BatchWorkItem): string[] {
  const mapping: Record<ReviewIssue, string> = { ncm: 'NCM', cest: 'CEST', 'cst-cclasstrib': 'CST/cClassTrib' };
  return reviewIssues(ctx, item).map((issue) => mapping[issue]);
}
