import type { BatchRow } from '../core/types';

/** Texto posicionado do PDF.js. Os valores são coordenadas da própria página. */
export type PositionedPdfLine = {
  y: number;
  text: string;
  tokens: { text: string; x: number; y: number; width: number }[];
};

/**
 * Extrai a tabela "Dados Fiscais de Produtos" do Cervantes quando NCM/CEST
 * estão vazios.  Trabalha com a GEOMETRIA do PDF, e não com a presença de NCM.
 * Nenhuma coluna de ICMS/PIS/COFINS é reutilizada como IBS/CBS.
 *
 * O relatório quebra a descrição longa antes/depois da linha central do código,
 * daí associarmos fragmentos pela distância vertical do código, não pela linha.
 */
export function parseCervantesFiscalPage(lines: PositionedPdfLine[], start = 0): BatchRow[] {
  const all = lines.flatMap((line) => line.tokens);
  const codes = all
    .filter((t) => t.x >= 14 && t.x < 53 && /^\d{1,7}$/.test(t.text.trim()))
    .filter((t) => all.some((u) => u.x >= 335 && u.x < 376 && /^(UN|UND|KG|CX|PC|PCT|LT|L|ML)$/i.test(u.text.trim()) && Math.abs(u.y - t.y) <= 4.5))
    .sort((a, b) => b.y - a.y);

  const rows: BatchRow[] = [];
  for (const code of codes) {
    const pieces = all
      .filter((t) => t.x >= 57 && t.x < 336 && Math.abs(t.y - code.y) <= 8.5)
      .sort((a, b) => Math.abs(b.y - a.y) > 2.4 ? b.y - a.y : a.x - b.x)
      .map((t) => t.text.trim()).filter(Boolean);
    const descricao = pieces.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!descricao) continue;
    const atBand = (left: number, right: number, digits: number) => {
      const text = all.filter((t) => t.x >= left && t.x < right && Math.abs(t.y - code.y) <= 4.5)
        .map((t) => t.text).join('').replace(/\D/g, '');
      return text.length === digits && !/^0+$/.test(text) ? text : '';
    };
    rows.push({
      __row: start + rows.length + 1,
      codigo: code.text.trim(),
      descricao,
      ncm: atBand(378, 425, 8),
      cest: atBand(427, 472, 7),
      cst: '',
      cClassTrib: '',
    });
  }
  return rows;
}

export function isCervantesFiscalReport(lines: PositionedPdfLine[]): boolean {
  const normalized = lines.map((line) => line.text).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /dados\s+fiscais\s+de\s+produtos/.test(normalized)
    && /\bcodigo\b/.test(normalized) && /\bncm\b/.test(normalized);
}
