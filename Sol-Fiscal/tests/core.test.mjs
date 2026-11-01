import assert from 'node:assert/strict';
import { classifyProduct } from '../.core-test/engine.js';
import { buildBatchWorkItem, applyManualFiscalEdit } from '../.core-test/batch-engine.js';
import { formatNcm, normalizeDigits } from '../.core-test/normalize.js';
import { validateFields } from '../.core-test/validation.js';
import { validateCnpj, formatCnpj, calculateCnpjDv } from '../.core-test/cnpj.js';
import { decodeBatchSnapshot, encodeBatchSnapshot, isBatchSnapshotComplete } from '../.core-test/session-snapshot.js';

assert.equal(normalizeDigits('8517.13.00'), '85171300');
assert.equal(formatNcm('85171300'), '8517.13.00');
assert.equal(validateFields({ cst: '0000' })[0].expected, '3 dígitos');
assert.equal(calculateCnpjDv('12ABC34501DE'), '35');
assert.equal(validateCnpj('12.ABC.345/01DE-35').valid, true);
assert.equal(validateCnpj('12.ABC.345/01DE-34').valid, false);
assert.equal(validateCnpj('42.064.856/0001-70').valid, true);
assert.equal(formatCnpj('12ABC34501DE35'), '12.ABC.345/01DE-35');

const context = {
  ncm: [
    { codigo: '85171300', descricao: 'Telefones inteligentes' },
    { codigo: '01022110', descricao: 'Bovinos' },
    { codigo: '02101100', descricao: 'Carnes' },
  ],
  cest: [],
  classtrib: [
    { cst: '000', cClassTrib: '000001', descricao: 'Tributação integral' },
    { cst: '200', cClassTrib: '200003', descricao: 'Cesta básica' },
    { cst: '200', cClassTrib: '200038', descricao: 'Insumos agropecuários' },
  ],
  rules: [],
  fiscalCatalog: {
    id: 'TEST-CATALOG',
    date: '2026-07-27',
    official: ['85171300', '01022110', '02101100'],
    special: {
      '01022110': { s: 'AMARELO', cst: '200', cc: '200038', n: 1, base: 'Regra determinística' },
      '02101100': { s: 'VERMELHO', n: 2 },
    },
    options: {
      '02101100': [
        { r: 'Opção 1', cst: '200', cc: '200003', base: 'Cesta básica' },
        { r: 'Opção 2', cst: '200', cc: '200038', base: 'Insumo agropecuário' },
      ],
    },
  },
  baseVersions: { fiscalCatalog: 'TEST-CATALOG' },
};

const defaultAuto = classifyProduct(context, { descricao: 'telefone', ncm: '8517.13.00', cest: '9999999' });
assert.equal(defaultAuto.status, 'validado');
assert.equal(defaultAuto.resolved.cClassTrib?.cst, '000');
assert.equal(defaultAuto.resolved.cClassTrib?.codigo, '000001');
assert.equal(defaultAuto.confidence, 'média');
assert.equal(defaultAuto.warnings.length, 1);
assert.equal(defaultAuto.resolved.cest, null);

const specialAuto = classifyProduct(context, { ncm: '01022110' });
assert.equal(specialAuto.status, 'validado');
assert.equal(specialAuto.resolved.cClassTrib?.cst, '200');
assert.equal(specialAuto.resolved.cClassTrib?.codigo, '200038');

const multiple = classifyProduct(context, { ncm: '02101100' });
assert.equal(multiple.status, 'revisão');
assert.equal(multiple.candidates.cClassTrib.length, 2);
assert.equal(multiple.resolved.cClassTrib, null);

const chosen = classifyProduct(context, { ncm: '02101100', cst: '200', cClassTrib: '200003', manualConfirmed: true });
assert.equal(chosen.status, 'validado');
assert.equal(chosen.resolved.cClassTrib?.codigo, '200003');


const existingAlternative = classifyProduct(context, { ncm: '02101100', cst: '200', cClassTrib: '200038' });
assert.equal(existingAlternative.status, 'validado');
assert.equal(existingAlternative.resolved.cClassTrib?.codigo, '200038');

const manualOverride = classifyProduct(context, { ncm: '02101100', cst: '200', cClassTrib: '200099', manualConfirmed: true });
assert.equal(manualOverride.status, 'validado');
assert.equal(manualOverride.confidence, 'média');
assert.equal(manualOverride.resolved.cClassTrib?.codigo, '200099');
assert.equal(manualOverride.warnings.length, 1);

const invalidManualPrefix = classifyProduct(context, { ncm: '02101100', cst: '000', cClassTrib: '200099', manualConfirmed: true });
assert.equal(invalidManualPrefix.status, 'revisão');

const invalid = classifyProduct(context, { descricao: 'telefone inteligente', ncm: '00000000' });
assert.equal(invalid.status, 'revisão');

const work = buildBatchWorkItem(context, { __row: 2, codigo: '1', ncm: '01022110' }, 'x');
assert.equal(work.row.cst, '200');
assert.equal(work.row.cClassTrib, '200038');
assert.equal(work.appliedBy, 'motor');

const redWork = buildBatchWorkItem(context, { __row: 3, codigo: '2', ncm: '02101100' }, 'y');
assert.equal(redWork.result.status, 'revisão');
const manual = applyManualFiscalEdit(context, redWork, { ncm: '02101100', cst: '200', cClassTrib: '200003' });
assert.equal(manual.result.status, 'validado');
assert.equal(manual.appliedBy, 'manual');


// Snapshot fiscal: uma atualização de base não pode reclassificar silenciosamente
// um lote que já foi salvo/finalizado.
const snapshotItem = buildBatchWorkItem(context, { __row: 4, codigo: '3', ncm: '85171300' }, 'snapshot');
const encodedSnapshot = encodeBatchSnapshot([snapshotItem]);
const changedContext = {
  ...context,
  fiscalCatalog: {
    ...context.fiscalCatalog,
    id: 'TEST-CATALOG-NEW',
    special: {
      ...context.fiscalCatalog.special,
      '85171300': { s: 'AMARELO', cst: '200', cc: '200038', n: 1, base: 'Nova regra de teste' },
    },
  },
  baseVersions: { fiscalCatalog: 'TEST-CATALOG-NEW', cClassTrib: 'TEST-CATALOG-NEW • 2026-10-07' },
};
const preserved = decodeBatchSnapshot(changedContext, encodedSnapshot, 'refresh');
assert.equal(preserved[0].row.cClassTrib, '000001');
assert.equal(preserved[0].result.resolved.cClassTrib?.codigo, '000001');
assert.equal(preserved[0].result.sources?.fiscalCatalog, 'TEST-CATALOG');

// Lotes antigos sem `result` são congelados quando estavam prontos, mas podem
// ser reanalisados explicitamente quando o operador assim decidir.
const legacyPayload = JSON.stringify([{
  id: 'legacy',
  row: { __row: 5, codigo: '4', ncm: '85171300', cst: '000', cClassTrib: '000001' },
  original: { __row: 5, codigo: '4', ncm: '85171300', cst: '', cClassTrib: '' },
  applied: true,
  appliedBy: 'motor',
}]);
const frozenLegacy = decodeBatchSnapshot(changedContext, legacyPayload, 'freeze');
assert.equal(frozenLegacy[0].row.cClassTrib, '000001');
assert.equal(frozenLegacy[0].result.resolved.cClassTrib?.codigo, '000001');
assert.equal(frozenLegacy[0].result.sources?.snapshot, 'legado');
assert.equal(isBatchSnapshotComplete(frozenLegacy), true);

const refreshedLegacy = decodeBatchSnapshot(changedContext, legacyPayload, 'refresh');
assert.equal(refreshedLegacy[0].result.resolved.cClassTrib?.codigo, '200038');
assert.equal(refreshedLegacy[0].row.cClassTrib, '200038');
assert.equal(isBatchSnapshotComplete([{ ...frozenLegacy[0], row: { ...frozenLegacy[0].row, cst: '000', cClassTrib: '200001' } }]), false);

console.log('Core tests: OK');

// Regressões: NCM real presente na tabela NCM mais nova, mas ausente do
// catálogo fiscal antigo. Não se deve alegar que o NCM inexiste.
const { reviewIssues, needsReview } = await import('../.core-test/review.js');
const { applyCestReviewDecision } = await import('../.core-test/batch-engine.js');
const updatedContext = {
  ...context,
  ncm: [...context.ncm, { codigo: '12345678', descricao: 'Produto existente na nova tabela NCM' }],
};
const recognizedNew = classifyProduct(updatedContext, { ncm: '12345678' });
assert.equal(recognizedNew.resolved.ncm?.codigo, '12345678');
assert.equal(recognizedNew.status, 'revisão'); // Sem regra fiscal não presume 000/000001.
assert.match(recognizedNew.decision, /ausente do catálogo/i);
const newNcmItem = buildBatchWorkItem(updatedContext, { __row: 20, codigo: '20', ncm: '12345678' }, 'new-ncm');
const newNcmManual = applyManualFiscalEdit(updatedContext, newNcmItem, { ncm: '12345678', cst: '200', cClassTrib: '200099' });
assert.equal(newNcmManual.result.status, 'validado');
assert.equal(newNcmManual.row.cst, '200');
assert.equal(newNcmManual.row.cClassTrib, '200099');
assert.equal(needsReview(updatedContext, newNcmManual), false);

// Valor informado com NCM inexistente NÃO é descartado e não é validado.
const unknownNcmItem = buildBatchWorkItem(context, { __row: 21, ncm: '99999999' }, 'unknown');
const unknownWithManual = applyManualFiscalEdit(context, unknownNcmItem, { ncm: '99999999', cst: '200', cClassTrib: '200099' });
assert.equal(unknownWithManual.result.status, 'revisão');
assert.equal(unknownWithManual.row.cClassTrib, '200099');
assert.deepEqual(reviewIssues(context, unknownWithManual), ['ncm', 'cst-cclasstrib']);

const cestContext = {
  ...context,
  cest: [{ cest: '1203400', ncm: '85171300', descricao: 'Exemplo hipotético de CEST para testar o fluxo' }],
};
const cestWork = buildBatchWorkItem(cestContext, { __row: 22, ncm: '85171300', descricao: 'Produto exemplo' }, 'cest');
assert.deepEqual(reviewIssues(cestContext, cestWork), ['cest']);
const cestNa = applyCestReviewDecision(cestContext, cestWork, null);
assert.equal(cestNa.cestDecision, 'nao-aplicavel');
assert.equal(needsReview(cestContext, cestNa), false);
const cestConfirmed = applyCestReviewDecision(cestContext, cestWork, '1203400');
assert.equal(cestConfirmed.row.cest, '1203400');
assert.equal(needsReview(cestContext, cestConfirmed), false);
const cestWrong = { ...cestWork, row: { ...cestWork.row, cest: '9999999' } };
assert.deepEqual(reviewIssues(cestContext, cestWrong), ['cest']);
assert.throws(() => applyCestReviewDecision(cestContext, cestWrong, '9999999'), /não compatível/);
assert.equal(needsReview(cestContext, { ...cestWrong, reviewDecision: 'ignorado' }), true);
assert.equal(isBatchSnapshotComplete([cestWork], cestContext), false);
assert.equal(isBatchSnapshotComplete([cestNa], cestContext), true);
assert.equal(JSON.parse(encodeBatchSnapshot([cestNa], cestContext))[0].pendingReview, false);
assert.equal(JSON.parse(encodeBatchSnapshot([cestWork], cestContext))[0].pendingReview, true);

console.log('Regressões: NCM novo, revisão, CEST e snapshot: OK');
const { applyReviewedNcmCorrection } = await import('../.core-test/batch-engine.js');
const manualPreviously = applyManualFiscalEdit(context, redWork, { ncm: '02101100', cst: '200', cClassTrib: '200099' });
const manualNcmCorrected = applyReviewedNcmCorrection(context, manualPreviously, '85171300', true);
assert.equal(manualNcmCorrected.row.cClassTrib, '200099');
assert.equal(manualNcmCorrected.result.status, 'validado');
assert.equal(manualNcmCorrected.row.manualConfirmed, true);
const manualNcmReset = applyReviewedNcmCorrection(context, manualPreviously, '85171300', false);
assert.equal(manualNcmReset.row.cClassTrib, '000001');
assert.equal(manualNcmReset.row.manualConfirmed, false);
console.log('Regressão: edição de NCM preserva somente classificação manual reconfirmada: OK');
