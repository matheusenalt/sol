import type { BatchWorkItem, SolCoreContext } from '../core/types.js';
import { normalizeDigits } from '../core/normalize.js';
import { isCestCompatible } from '../core/cest.js';
import { needsReview, reviewIssueLabels } from '../core/review.js';

/** Exporta campos confirmados sem destruir o registro do que foi preenchido. */
export function toFiscalCompleteRows(ctx: SolCoreContext, items: BatchWorkItem[]) {
  return items.map((item) => {
    const ncmOk = Boolean(item.result.resolved.ncm);
    const cls = item.result.resolved.cClassTrib;
    const cest = normalizeDigits(item.row.cest);
    const cestOk = ncmOk && cest && isCestCompatible(ctx.cest, item.row.ncm || '', cest);
    const issues = reviewIssueLabels(ctx, item);
    return {
      Código: item.row.codigo || '',
      Produto: item.row.descricao || '',
      NCM: ncmOk ? normalizeDigits(item.result.resolved.ncm?.codigo) : '',
      NCM_informado_pendente: ncmOk ? '' : normalizeDigits(item.row.ncm),
      NCM_sugerido_pendente: ncmOk ? '' : normalizeDigits(item.result.candidates.ncm[0]?.code),
      CEST: cestOk ? cest : '',
      CEST_informado_pendente: cest && !cestOk ? cest : '',
      CEST_decisao: item.cestDecision === 'nao-aplicavel' ? 'Não aplicável (revisado)' : cestOk ? 'Confirmado' : '',
      CST_IBS_CBS: cls?.cst || '',
      CST_informado_pendente: cls ? '' : normalizeDigits(item.row.cst),
      cClassTrib: cls?.codigo || '',
      cClassTrib_informado_pendente: cls ? '' : normalizeDigits(item.row.cClassTrib),
      Status: issues.length ? 'REVISÃO PENDENTE' : 'RESOLVIDO',
      Pendencias: issues.join(' / '),
      Origem: item.appliedBy === 'manual' ? 'Revisado manualmente' : 'Sol Core',
      Observacao: item.result.warnings.join(' | ') || item.result.decision,
    };
  });
}
