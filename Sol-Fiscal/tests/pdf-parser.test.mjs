import assert from 'node:assert/strict';
import { detectCompanyFromPdfTextLines, parseFiscalProductLine } from '../.imports-test/imports/pdf-row-parser.js';

const cases = [
  ['010 AMSTEL 355ML UN 22030000 500 99 0,00 99 0,00', { codigo: '010', descricao: 'AMSTEL 355ML', ncm: '22030000' }],
  ['060 CAMARÃO À MILANESA UN 21069090 500 99 0,00 99 0,00', { codigo: '060', descricao: 'CAMARÃO À MILANESA', ncm: '21069090' }],
  ['037 CHORIZO - ESPETO KG 21069090 500 99 0,00 99 0,00', { codigo: '037', descricao: 'CHORIZO - ESPETO', ncm: '21069090' }],
  ['023 COCA COLA 1L UN 22021000 500 99 0,00 99 0,00', { codigo: '023', descricao: 'COCA COLA 1L', ncm: '22021000' }],
  ['048 CORAÇÃOZINHO AO MOLHO BARBECUE UN 21069090 500 99 0,00 99 0,00', { codigo: '048', descricao: 'CORAÇÃOZINHO AO MOLHO BARBECUE', ncm: '21069090' }],
];

for (const [line, expected] of cases) {
  assert.deepEqual(parseFiscalProductLine(line), expected, line);
}

assert.equal(parseFiscalProductLine('Código Produto UN NCM CEST CBNef ICMS PIS COFINS'), null);
assert.equal(parseFiscalProductLine('Dados Fiscais de Produtos'), null);

const company = detectCompanyFromPdfTextLines([
  'EMPRESA DE TESTE',
  'Dados Fiscais de Produtos',
  'Data de impressão: 06/10/2026 09:23:31',
  'Código Produto UN NCM CEST CBNEF ICMS PIS COFINS',
  '010 AMSTEL 355ML UN 22030000 500 99 0,00 99 0,00',
]);
assert.equal(company, 'EMPRESA DE TESTE');

console.log('PDF parser tests: OK');
