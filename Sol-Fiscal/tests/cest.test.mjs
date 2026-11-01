import assert from 'node:assert/strict';
import { cestMatchesNcm, findCestForNcm } from '../.core-test/cest.js';

const cases = [
  ['2202.10.00', '22021000', true],
  ['2202', '22021000', true],
  ['3815.12.10, 3815.12.90', '38151290', true],
  ['Capítulo 33', '33051000', true],
  ['Capítulos 13 e 15 a 23', '18069000', true],
  ['Capítulos 13 e 15 a 23', '14000000', false],
];

for (const [expression, ncm, expected] of cases) {
  assert.equal(cestMatchesNcm(expression, ncm).matches, expected, `${expression} / ${ncm}`);
}

const exact = findCestForNcm([
  { cest: '0300700', ncm: '2202.10.00', descricao: 'Bebidas' },
  { cest: '0300800', ncm: '2202', descricao: 'Outras bebidas' },
], '22021000');
assert.equal(exact[0].item.cest, '0300700');
assert.equal(exact[0].confidence, 'alta');
assert.ok(exact[0].compatibility > exact[1].compatibility);

console.log('CEST matcher tests: OK');
