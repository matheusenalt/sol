import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { formatCnpj, validateCnpj } from '../core/cnpj';
import { getCnpjOnline, type OnlineCnpj } from '../services/cnpj-api';

export function CnpjPage() {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<OnlineCnpj | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const validation = useMemo(() => validateCnpj(value), [value]);

  async function search(forceRefresh = false) {
    setLoading(true); setMessage(''); if (!forceRefresh) setResult(null);
    try {
      const row = await getCnpjOnline(value, forceRefresh);
      if (!row) setMessage('CNPJ não encontrado nas fontes consultadas.');
      else setResult(row);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao consultar CNPJ.');
    } finally { setLoading(false); }
  }

  async function useCompanyInActiveLot() {
    if (!result?.razao_social) return;
    try {
      await invoke('rename_active_company', { companyName: result.razao_social });
      setMessage(`Lote atual renomeado para ${result.razao_social}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error || 'Não foi possível renomear o lote atual.'));
    }
  }

  const address = result ? [result.logradouro, result.numero, result.complemento, result.bairro, result.municipio, result.uf].filter(Boolean).join(', ') : '';
  const ies = result?.inscricoes_estaduais || [];

  return (
    <div className="card search-tool-card narrow-wide">
      <div className="tool-title">
        <div>
          <h2>Consulta CNPJ</h2>
          <p>Consulta cadastral com cache local. Quando a fonte retornar inscrições estaduais, o Sol também mostra IE, UF e situação.</p>
        </div>
      </div>
      <div className="search-line">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
          onKeyDown={(event) => event.key === 'Enter' && validation.valid && search()}
          placeholder="Ex.: 12.ABC.345/01DE-35"
          maxLength={18}
        />
        <button className="primary" onClick={() => search()} disabled={loading || !validation.valid}>{loading ? 'Consultando…' : 'Consultar'}</button>
      </div>

      {value.trim() && <div className={`validation compact-validation ${validation.valid ? 'ok' : 'bad'}`}>
        <b>{validation.valid ? (validation.alphanumeric ? 'CNPJ alfanumérico válido' : 'CNPJ válido') : validation.reason}</b>
        <span>{validation.clean.length === 14 ? formatCnpj(validation.clean) : `${validation.clean.length}/14 posições`}</span>
      </div>}

      {message && <div className="warning-block">{message}</div>}
      {result && <div className="cnpj-result">
        <div className="result-head">
          <div><small>CNPJ</small><h2>{formatCnpj(result.cnpj)}</h2></div>
          <span className="badge validado">{result.descricao_situacao_cadastral || 'consultado'}</span>
        </div>
        <div className="cnpj-source-line">
          <span>{result.cached ? 'Resultado do cache local' : 'Consulta atualizada'}</span>
          <div className="inline-actions">
            <button className="secondary small" onClick={() => navigator.clipboard?.writeText(result.cnpj)}>Copiar CNPJ</button>
            {result.razao_social && <button className="secondary small" onClick={() => navigator.clipboard?.writeText(result.razao_social || '')}>Copiar razão social</button>}
            {result.razao_social && <button className="secondary small" onClick={useCompanyInActiveLot}>Usar no lote atual</button>}
            <button className="secondary small" onClick={() => search(true)} disabled={loading}>Atualizar agora</button>
          </div>
        </div>
        <dl>
          <dt>Razão social</dt><dd>{result.razao_social || '—'}</dd>
          <dt>Fantasia</dt><dd>{result.nome_fantasia || '—'}</dd>
          <dt>CNAE principal</dt><dd>{result.cnae_fiscal ? `${result.cnae_fiscal} — ${result.cnae_fiscal_descricao || ''}` : '—'}</dd>
          <dt>Início atividade</dt><dd>{result.data_inicio_atividade || '—'}</dd>
          <dt>Endereço</dt><dd>{address || '—'}</dd>
          <dt>CEP</dt><dd>{result.cep || '—'}</dd>
          <dt>Telefone</dt><dd>{result.ddd_telefone_1 || '—'}</dd>
          <dt>E-mail</dt><dd>{result.email || '—'}</dd>
          <dt>Porte</dt><dd>{result.porte || '—'}</dd>
          <dt>Natureza jurídica</dt><dd>{result.natureza_juridica || '—'}</dd>
          <dt>Inscrição estadual</dt><dd>{ies.length ? <div className="ie-list">{ies.map((ie, index) => <div className="ie-row" key={`${ie.inscricao_estadual}-${ie.uf || index}`}><b>{ie.inscricao_estadual}</b><span>{ie.uf || 'UF não informada'}{ie.ativo === true ? ' • ativa' : ie.ativo === false ? ' • inativa' : ''}{ie.regime ? ` • ${ie.regime}` : ''}</span><button className="secondary small" onClick={() => navigator.clipboard?.writeText(ie.inscricao_estadual)}>Copiar IE</button></div>)}</div> : 'Não retornada para este CNPJ/UF'}</dd>
          <dt>Base atualizada em</dt><dd>{result.data_updated_at || 'Não informado pela fonte'}</dd>
        </dl>
      </div>}
      <p className="footnote">A disponibilidade de IE varia por UF e pela fonte cadastral. O Sol mantém o resultado em cache para acelerar consultas repetidas.</p>
    </div>
  );
}
