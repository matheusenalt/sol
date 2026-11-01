import assert from 'node:assert/strict';
import { toCervantesRows } from '../.export-test/exports/cervantes.js';

const baseResult = {
  engineVersion: 'test', status: 'validado', confidence: 'alta', input: {},
  resolved: { ncm: { codigo: '22030000', codigoFormatado: '2203.00.00', validated: true }, cest: null, cClassTrib: { codigo: '000001', cst: '000', descricao: 'x', validated: true } },
  candidates: { ncm: [], cest: [], cClassTrib: [] }, warnings: [], decision: 'ok'
};
const items = [
  { id: '1', row: { __row: 1, codigo: '010', descricao: 'AMSTEL 355ML', ncm: '22030000', cst: '000', cClassTrib: '000001' }, original: { __row: 1 }, applied: false, result: baseResult },
  { id: '2', row: { __row: 2, codigo: '060', descricao: 'CAMARÃO À MILANESA', ncm: '21069090', cst: '', cClassTrib: '' }, original: { __row: 2 }, applied: false, result: { ...baseResult, status: 'revisão', resolved: { ...baseResult.resolved, ncm: { codigo: '21069090', codigoFormatado: '2106.90.90', validated: true }, cClassTrib: null } } }
];
const rows = toCervantesRows(items);
assert.deepEqual(Object.keys(rows[0]), ['Código', 'Produto', 'NCM', 'cClassTrib']);
assert.deepEqual(rows[0], { Código: '010', Produto: 'AMSTEL 355ML', NCM: '22030000', cClassTrib: '000001' });
assert.equal(rows[1].cClassTrib, '');
console.log('Cervantes export tests: OK');

const { toFiscalCompleteRows } = await import('../.export-test/exports/fiscal-rows.js');
const mockContext = { ncm: [], cest: [], classtrib: [], rules: [] };
const fiscalRows = toFiscalCompleteRows(mockContext, items);
assert.equal(fiscalRows[0].NCM, '22030000');
assert.equal(fiscalRows[0].CST_IBS_CBS, '000');
assert.equal(fiscalRows[1].NCM, '21069090');
assert.equal(fiscalRows[1].Status, 'REVISÃO PENDENTE');
const notRecognized = { ...items[1], row: { ...items[1].row, ncm: '99999999', cst: '200', cClassTrib: '200099' }, result: { ...items[1].result, resolved: { ...items[1].result.resolved, ncm: null } } };
const unconfirmed = toFiscalCompleteRows(mockContext, [notRecognized])[0];
assert.equal(unconfirmed.NCM, '');
assert.equal(unconfirmed.NCM_informado_pendente, '99999999');
assert.equal(unconfirmed.CST_informado_pendente, '200');
assert.equal(unconfirmed.cClassTrib_informado_pendente, '200099');
assert.equal(unconfirmed.cClassTrib, '');
console.log('Exportação parcial com rastreabilidade: OK');
