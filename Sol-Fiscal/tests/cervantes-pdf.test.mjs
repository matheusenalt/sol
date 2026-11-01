import assert from 'node:assert/strict';
import { parseCervantesFiscalPage, isCervantesFiscalReport } from '../.imports-test/imports/cervantes-pdf.js';
// Fixture inteiramente sintetica: reproduz as posicoes de colunas Cervantes.
const token = (text, x, y) => ({ text, x, y, width: 25 });
const rows = [
  [10, 'ÁGUA COM GÁS', 460],
  [11, 'EMPADA DE FRANGO', 440],
  [12, 'MACARRÃO COM CARNE', 420],
  [13, 'REFRIGERANTE LATA', 400],
  [14, 'CHÁ SEM AÇÚCAR', 380],
];
const tokens = [token('Dados Fiscais de Produtos', 180, 490), token('Código', 30, 480), token('Produto', 180, 480), token('NCM', 388, 480), token('CEST', 434, 480)];
for (const [code, desc, y] of rows) {
  tokens.push(token(String(code), 32, y), token(desc, 70, y), token('UN', 348, y),
    token('500', 530, y), token('99', 632, y), token('99', 723, y));
}
// Um nome extenso continua correto quando quebra duas linhas.
tokens.push(token('SERVIDO COM ACOMPANHAMENTO', 68, 414));
const lines = [...new Set(tokens.map(t => t.y))].map(y => {
  const own = tokens.filter(t => t.y === y);
  return { y, text: own.map(t => t.text).join(' '), tokens: own };
});
assert.equal(isCervantesFiscalReport(lines), true);
const parsed = parseCervantesFiscalPage(lines);
assert.equal(parsed.length, 5);
assert.equal(new Set(parsed.map(r => r.codigo)).size, 5);
assert.equal(parsed.find(r => r.codigo === '12')?.descricao, 'MACARRÃO COM CARNE SERVIDO COM ACOMPANHAMENTO');
assert.ok(parsed.every(r => r.ncm === '' && r.cest === '' && r.cst === '' && r.cClassTrib === ''));
console.log('PDF Cervantes - fixture sintetica, colunas sem NCM, texto multilinha: OK');
