import { useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { findCestForNcm } from '../core/cest';
import { formatCest, formatNcm, normalizeDigits } from '../core/normalize';
import { coreContext } from '../data/loaders';

export function CestPage() {
  const [query, setQuery] = useState('');
  const normalizedQuery = normalizeDigits(query);
  const textQuery = query.trim().toLowerCase();
  const isFullNcm = normalizedQuery.length === 8;

  const ncmMatches = useMemo(
    () => isFullNcm ? findCestForNcm(coreContext.cest, normalizedQuery) : [],
    [isFullNcm, normalizedQuery],
  );

  const rows = useMemo(() => {
    if (isFullNcm) return ncmMatches.map((match) => ({ row: match.item, confidence: match.confidence, compatibility: match.compatibility }));
    return coreContext.cest
      .filter((item) => !textQuery
        || (normalizedQuery.length > 0 && normalizeDigits(item.cest).includes(normalizedQuery))
        || (normalizedQuery.length > 0 && normalizeDigits(item.ncm).includes(normalizedQuery))
        || item.descricao.toLowerCase().includes(textQuery))
      .slice(0, 500)
      .map((row) => ({ row, confidence: undefined, compatibility: undefined }));
  }, [isFullNcm, ncmMatches, textQuery, normalizedQuery]);

  return (
    <div className="card search-tool-card">
      <div className="tool-title">
        <div>
          <h2>Buscar CEST</h2>
          <p>Informe CEST, descrição ou um NCM completo. Para NCM, o Sol mostra todos os CEST cujo código ou faixa inclui o produto.</p>
        </div>
      </div>
      <div className="search-line">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: 2202.10.00, bebida ou 03.007.00" />
        <button className="secondary" onClick={() => setQuery('')}>Limpar</button>
      </div>

      {isFullNcm && <div className="validation compact-validation ok">
        <b>{ncmMatches.length ? `${ncmMatches.length} CEST relacionado(s) ao NCM` : 'Nenhum CEST relacionado na base local'}</b>
        <span>{formatNcm(normalizedQuery)}</span>
      </div>}

      <div className="table-wrap tool-table-wrap"><table><thead><tr><th>CEST</th><th>NCM/SH abrangido</th><th>Descrição</th>{isFullNcm && <th>Compatibilidade</th>}<th></th></tr></thead><tbody>{rows.map(({ row, confidence, compatibility }, index) => (
        <tr key={`${row.cest}-${index}`}>
          <td><code>{formatCest(row.cest)}</code></td>
          <td>{normalizeDigits(row.ncm).length === 8 ? formatNcm(row.ncm) : row.ncm}</td>
          <td>{row.descricao}</td>
          {isFullNcm && <td><div className="compat-cell"><Badge value={confidence || 'baixa'} /><small>{compatibility === undefined ? '' : `${Math.round(compatibility * 100)}%`}</small></div></td>}
          <td><div className="inline-actions"><button className="icon-button" onClick={() => navigator.clipboard?.writeText(normalizeDigits(row.cest))}>Copiar CEST</button>{isFullNcm && <button className="icon-button" onClick={() => navigator.clipboard?.writeText(normalizedQuery)}>Copiar NCM</button>}</div></td>
        </tr>
      ))}</tbody></table></div>
      {!rows.length && <div className="empty">Nenhum CEST encontrado.</div>}
      <p className="footnote">O vínculo NCM→CEST indica compatibilidade cadastral. Ele não prova, sozinho, incidência de ICMS-ST: UF, mercadoria e legislação ainda precisam ser consideradas.</p>
    </div>
  );
}
