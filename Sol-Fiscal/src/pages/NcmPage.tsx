import { useMemo, useState } from 'react';
import { formatNcm, normalizeDigits, textScore } from '../core/normalize';
import { Badge } from '../components/Badge';
import { coreContext } from '../data/loaders';
import { getNcmOnline, searchNcmOnline, type OnlineNcm } from '../services/brasil-api';


function ncmLifecycle(row: OnlineNcm): 'vigente' | 'inativo' | 'futuro' {
  const today = new Date().toISOString().slice(0, 10);
  if (row.data_inicio && row.data_inicio > today) return 'futuro';
  if (row.data_fim && row.data_fim !== '9999-12-31' && row.data_fim < today) return 'inativo';
  return 'vigente';
}

export function NcmPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OnlineNcm[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [successors, setSuccessors] = useState<OnlineNcm[]>([]);
  const normalized = normalizeDigits(query);
  const localFound = useMemo(() => normalized.length === 8 && coreContext.ncm.some(
    (item) => normalizeDigits(item.codigo) === normalized,
  ), [normalized]);
  const rankedResults = useMemo(() => results.map((row) => {
    const score = normalized.length === 8 ? 1 : textScore(query, row.descricao || '');
    const confidence = score >= 0.7 ? 'alta' : score >= 0.38 ? 'média' : 'baixa';
    return { row, score, confidence };
  }).sort((a, b) => b.score - a.score), [results, query, normalized.length]);

  async function search() {
    const clean = query.trim();
    if (!clean) return;
    setLoading(true); setMessage(''); setResults([]); setSuccessors([]);
    try {
      if (normalized.length === 8 && /^\D*\d[\d.\s-]*$/.test(clean)) {
        try {
          const exact = await getNcmOnline(normalized);
          if (exact) {
            setResults([exact]);
            if (ncmLifecycle(exact) === 'inativo' && exact.descricao) {
              try {
                const related = await searchNcmOnline(exact.descricao);
                const active = related
                  .filter((row) => normalizeDigits(row.codigo) !== normalized && ncmLifecycle(row) === 'vigente')
                  .sort((a, b) => textScore(exact.descricao || '', b.descricao || '') - textScore(exact.descricao || '', a.descricao || ''))
                  .slice(0, 8);
                setSuccessors(active);
              } catch { /* consulta auxiliar; o status inativo continua válido */ }
            }
          }
          else if (!localFound) setMessage('NCM não encontrado nas bases consultadas.');
          else setMessage('NCM validado localmente. A descrição detalhada não ficou disponível agora.');
        } catch (error) {
          if (localFound) setMessage('NCM validado localmente. A consulta de descrição online está indisponível no momento.');
          else throw error;
        }
      } else {
        const rows = await searchNcmOnline(clean);
        setResults(rows);
        if (!rows.length) setMessage('Nenhum NCM encontrado. Tente uma descrição mais objetiva, como “refrigerante”, “papel higiênico” ou “arroz”.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao consultar NCM.');
    } finally { setLoading(false); }
  }

  return (
    <div className="card search-tool-card">
      <div className="tool-title"><div><h2>Buscar NCM</h2><p>Pesquise pelo código completo ou por uma descrição objetiva. Códigos conhecidos continuam sendo validados mesmo sem internet.</p></div></div>
      <div className="search-line">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && search()} placeholder="Ex.: papel higiênico, refrigerante ou 2202.10.00" />
        <button className="primary" onClick={search} disabled={loading || !query.trim()}>{loading ? 'Buscando…' : 'Buscar'}</button>
      </div>

      {normalized.length === 8 && <div className={`validation compact-validation ${localFound ? 'ok' : 'bad'}`}><div className="validation-title"><b>{localFound ? 'NCM reconhecido na base fiscal local' : 'NCM não encontrado no snapshot local'}</b><Badge value={localFound ? 'vigente' : 'revisar'} /></div><span>{formatNcm(normalized)}</span><button className="secondary small" onClick={() => navigator.clipboard?.writeText(normalized)}>Copiar NCM</button></div>}
      {message && <div className="warning-block">{message}</div>}

      {rankedResults.length > 0 && <div className="ncm-results">
        {rankedResults.map(({ row, score, confidence }) => {
          const lifecycle = ncmLifecycle(row);
          return <div className={`result-card ncm-${lifecycle}`} key={`${row.codigo}-${row.data_inicio || ''}`}>
            <div><span className="ncm-result-title"><code>{row.codigo}</code><Badge value={lifecycle} /></span><b>{row.descricao}</b>{normalized.length !== 8 && <span className="alternative-score"><Badge value={confidence} /><small>Compatibilidade {Math.round(score * 100)}%</small></span>}</div>
            <small>{row.data_inicio ? `Vigência: ${row.data_inicio}${row.data_fim && row.data_fim !== '9999-12-31' ? ` até ${row.data_fim}` : ''}` : 'Vigência não informada'}{row.tipo_ato ? ` • ${row.tipo_ato} ${row.numero_ato || ''}/${row.ano_ato || ''}` : ''}</small>
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(row.codigo.replace(/\D/g, ''))}>Copiar NCM</button>
          </div>;
        })}
      </div>}
      {successors.length > 0 && <div className="ncm-successors"><div><h3>Possíveis códigos vigentes relacionados</h3><p>O NCM consultado está inativo. Estes candidatos foram encontrados pela descrição na base vigente; use como apoio e confirme a correlação antes de alterar o cadastro.</p></div><div className="option-grid">{successors.map((row) => <div className="audit-option" key={`${row.codigo}-${row.data_inicio || ''}`}><div><b>{formatNcm(row.codigo)}</b><Badge value="vigente" /></div><p>{row.descricao}</p><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(normalizeDigits(row.codigo))}>Copiar NCM</button></div>)}</div></div>}
      <p className="footnote">Para classificação por descrição, quanto mais específico for o nome do produto, maior a confiabilidade. A validação fiscal final continua no Sol Core.</p>
    </div>
  );
}
