import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyProduct } from '../.core-test/engine.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/fiscal-catalog.json', import.meta.url), 'utf8'));
assert.equal(catalog.official.length, 10515, 'Quantidade de NCMs oficiais mudou inesperadamente.');
assert.equal(Object.keys(catalog.options).length, 321, 'Quantidade de NCMs contextuais mudou inesperadamente.');

const ctx = {
  ncm: catalog.official.map((codigo) => ({ codigo })),
  cest: [],
  classtrib: [],
  rules: [],
  fiscalCatalog: catalog,
  baseVersions: { fiscalCatalog: catalog.id },
};

let automaticos = 0;
let revisao = 0;
for (const ncm of catalog.official) {
  const result = classifyProduct(ctx, { ncm });
  if (result.status === 'validado') automaticos += 1;
  else if (result.status === 'revisão') revisao += 1;
  else assert.fail(`Status inesperado para ${ncm}: ${result.status}`);
}

assert.equal(automaticos, 10194);
assert.equal(revisao, 321);

const beer = classifyProduct(ctx, { ncm: '22030000' });
assert.equal(beer.status, 'validado');
assert.equal(beer.resolved.cClassTrib?.cst, '000');
assert.equal(beer.resolved.cClassTrib?.codigo, '000001');

const contextual = classifyProduct(ctx, { ncm: '02101100' });
assert.equal(contextual.status, 'revisão');
assert.ok(contextual.candidates.cClassTrib.length >= 2);

const firstAlternative = contextual.candidates.cClassTrib[0];
const existing = classifyProduct(ctx, {
  ncm: '02101100',
  cst: firstAlternative.data?.cst,
  cClassTrib: firstAlternative.code,
});
assert.equal(existing.status, 'validado', 'Alternativa já gravada deveria ser reconhecida sem nova escolha.');

console.log(`Catalog tests: OK (${automaticos} automáticos, ${revisao} revisão)`);
