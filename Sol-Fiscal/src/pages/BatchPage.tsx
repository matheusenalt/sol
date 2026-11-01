import { useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { buildBatchWorkItem, applyManualFiscalEdit, applyCestReviewDecision, applyReviewedNcmCorrection } from '../core/batch-engine';
import { needsReview } from '../core/review';
import { activeNcmDescriptionStatus, loadNcmDescriptions } from '../data/ncm-reference';
import { saveWorkspace } from '../database/workspace';
import { findCestForNcm, isCestCompatible } from '../core/cest';
import { formatCest, formatNcm, normalizeDigits } from '../core/normalize';
import type { BatchWorkItem } from '../core/types';
import { coreContext } from '../data/loaders';
import { saveHistory } from '../database/history';
import { startWorkspace } from '../database/workspace';
import { exportBatch, type ExportFormat } from '../exports/report';
import { readBatchFile } from '../imports/batch';
import { friendlyError } from '../security/errors';

type AnalysisMode = 'completa' | 'ncm' | 'cest' | 'ibs-cbs';

type Props = {
  rows: BatchWorkItem[];
  setRows: (rows: BatchWorkItem[]) => void;
  fileName: string;
  setFileName: (name: string) => void;
  companyName: string;
  setCompanyName: (name: string) => void;
  onNotice: (message: string) => void;
  onGoReview: () => void;
};

export function BatchPage({ rows, setRows, fileName, setFileName, companyName, setCompanyName, onNotice, onGoReview }: Props) {
  const [term, setTerm] = useState('');
  const [mode, setMode] = useState<AnalysisMode>('completa');
  const [exporting, setExporting] = useState<ExportFormat | ''>('');
  const [loading, setLoading] = useState(false);
  const [loadStage, setLoadStage] = useState('Analisando…');
  const [selectedId, setSelectedId] = useState('');
  const pending = rows.filter((row) => needsReview(coreContext, row));
  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => [item.row.codigo, item.row.descricao, item.row.ncm, item.row.cest, item.row.cst, item.row.cClassTrib]
      .join(' ').toLowerCase().includes(q));
  }, [rows, term]);
  const selected = rows.find((row) => row.id === selectedId) || rows[0] || null;

  const auditSummary = useMemo(() => rows.reduce((acc, item) => {
    const audit = auditItem(item, mode);
    if (audit.needsReview) acc.review += 1;
    else if (audit.needsAttention) acc.attention += 1;
    else acc.ok += 1;
    return acc;
  }, { ok: 0, attention: 0, review: 0 }), [rows, mode]);

  async function importFile(file?: File) {
    if (!file) return;
    if (rows.length && !window.confirm(`Substituir o lote ativo${companyName ? ` de ${companyName}` : ''}? O lote atual continua preservado no Histórico.`)) return;
    setLoading(true);
    try {
      setLoadStage('Lendo produtos…');
      const importedFile = await readBatchFile(file);
      setLoadStage('Consultando descrições NCM…');
      let ncmInfo = activeNcmDescriptionStatus();
      let ncmUnavailable = '';
      try { ncmInfo = await loadNcmDescriptions(true); }
      catch (error) { ncmUnavailable = error instanceof Error ? error.message : String(error); }
      setLoadStage('Pesquisando NCMs…');
      let company = importedFile.companyName.trim();
      const fallback = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (!company || company === fallback || company === 'Empresa não identificada') {
        company = window.prompt('Não consegui confirmar a empresa no arquivo. Informe o nome da empresa/cliente:', company || '')?.trim() || '';
      }
      if (!company) throw new Error('Informe a empresa para manter esta análise separada dos outros clientes.');

      const stamp = Date.now();
      const imported = importedFile.rows.map((row, index) => buildBatchWorkItem(coreContext, row, `audit-${stamp}-${row.__row}-${index}`));
      setRows(imported);
      setFileName(file.name);
      setCompanyName(company);
      setSelectedId(imported[0]?.id || '');
      await startWorkspace(file.name, imported, company);
      await saveHistory({
        kind: 'análise fiscal completa',
        summary: `${company} • ${file.name} • ${imported.length} produto(s)`,
        payload: JSON.stringify({ company, file: file.name, total: imported.length, duplicatesRemoved: importedFile.duplicatesRemoved, scope: 'NCM + CEST + CST IBS/CBS + cClassTrib' }),
      }).catch(() => undefined);
      onNotice(`${company}: ${imported.length} produto(s) carregados. ${ncmInfo ? `${ncmInfo.count} NCMs com descrição disponíveis para pesquisa.` : `A pesquisa por descrição depende da tabela NCM oficial. ${ncmUnavailable || 'Importe a base em Atualizações.'}`} ${importedFile.duplicatesRemoved ? `${importedFile.duplicatesRemoved} duplicado(s) removido(s).` : ''}`);
    } catch (error) {
      onNotice(friendlyError(error, 'Análise fiscal'));
    } finally {
      setLoading(false);
    }
  }

  function confirmNcmSuggestion(item: BatchWorkItem, code: string) {
    if (!window.confirm(`Aplicar NCM sugerido ${formatNcm(code)} a “${item.row.descricao}”? Confirme a descrição fiscal, composição e a classificação antes de prosseguir.`)) return;
    const keepManual = Boolean(item.row.manualConfirmed && item.row.cst && item.row.cClassTrib)
      && window.confirm('Manter CST e cClassTrib preenchidos manualmente e confirmar a adequação ao novo NCM? Cancelar recalcula o tratamento fiscal.');
    const changed = applyReviewedNcmCorrection(coreContext, item, code, keepManual);
    const next = rows.map((row) => row.id === item.id ? changed : row);
    setRows(next);
    saveWorkspace(fileName, next, companyName).catch(() => undefined);
    onNotice(`NCM ${formatNcm(code)} selecionado para ${item.row.codigo || item.row.descricao}. Confira as regras e o CEST antes de exportar.`);
  }

  function confirmCestSuggestion(item: BatchWorkItem, code: string) {
    if (!window.confirm(`Aplicar CEST ${formatCest(code)} a “${item.row.descricao}”? O vínculo do NCM é apenas uma hipótese de compatibilidade e NÃO define incidência de ICMS-ST.`)) return;
    const changed = applyCestReviewDecision(coreContext, item, code);
    const next = rows.map((row) => row.id === item.id ? changed : row);
    setRows(next);
    saveWorkspace(fileName, next, companyName).catch(() => undefined);
    onNotice(`CEST ${formatCest(code)} selecionado; confirme a aplicação fiscal com os documentos do produto e a UF.`);
  }

  async function exportFile(format: ExportFormat) {
    setExporting(format);
    try {
      const path = await exportBatch(rows, format, fileName || 'analise', companyName);
      if (!path) return;
      onNotice(`Arquivo salvo em: ${path}`);
      await saveHistory({ kind: 'exportação', summary: `${companyName} • ${format.toUpperCase()} • ${rows.length} itens`, payload: JSON.stringify({ company: companyName, path, format, total: rows.length }) });
    } catch (error) {
      onNotice(friendlyError(error, 'Exportação'));
    } finally {
      setExporting('');
    }
  }

  return <>
    <div className="card batch-analysis-head">
      <div className="tool-title">
        <div><h2>Análise fiscal em lote</h2><p>Importe PDF, Excel, CSV ou TXT e escolha se quer auditar tudo ou somente NCM, CEST ou IBS/CBS.</p></div>
      </div>
      <div className="batch-mode-row">
        <div className="segmented-control">
          <button className={mode === 'completa' ? 'active' : ''} onClick={() => setMode('completa')}>Completa</button>
          <button className={mode === 'ncm' ? 'active' : ''} onClick={() => setMode('ncm')}>Só NCM</button>
          <button className={mode === 'cest' ? 'active' : ''} onClick={() => setMode('cest')}>Só CEST</button>
          <button className={mode === 'ibs-cbs' ? 'active' : ''} onClick={() => setMode('ibs-cbs')}>Só CST/cClassTrib</button>
        </div>
        <label className="file-button primary">{loading ? loadStage : 'Importar lista'}<input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" onChange={(event) => importFile(event.target.files?.[0])} disabled={loading} /></label>
      </div>
      <p className="footnote">Se o PDF não trouxer um nome de empresa confiável, o Sol pergunta antes de criar o lote. CEST é validado como compatibilidade cadastral; a incidência de ICMS-ST depende também da operação e da UF.</p>
    </div>

    {!rows.length ? <div className="card"><Empty>Importe uma lista para iniciar a análise. O arquivo pode já ter NCM, CEST, CST e cClassTrib ou conter apenas parte desses campos.</Empty></div> : <>
      <div className="card">
        <div className="toolbar"><div><h2>{companyName || 'Lote ativo'}</h2><span>{fileName}</span></div><button className="secondary" onClick={onGoReview} disabled={!pending.length}>Revisar NCM / CEST / CST / cClassTrib ({pending.length})</button></div>
        <div className="metrics audit-metrics"><div><b>{rows.length}</b><span>Total</span></div><div><b>{auditSummary.ok}</b><span>Sem alerta</span></div><div><b>{auditSummary.attention}</b><span>Atenção</span></div><div><b>{auditSummary.review}</b><span>Revisão</span></div></div>
        <div className="batch-toolbar"><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar produto, código, NCM, CEST, CST, cClassTrib..." /></div>
        <div className="export-inline"><span>Resultado da análise atual.</span><div className="button-row"><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('xlsx')}>Excel…</button><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('csv')}>CSV…</button><button className="primary" disabled={Boolean(exporting)} onClick={() => exportFile('pdf')}>PDF…</button></div></div>
        <div className="table-wrap"><table className="selectable-table"><thead><tr><th>Produto</th>{mode !== 'cest' && mode !== 'ibs-cbs' && <th>NCM</th>}{mode !== 'ncm' && mode !== 'ibs-cbs' && <th>CEST</th>}{mode !== 'ncm' && mode !== 'cest' && <><th>CST</th><th>cClassTrib</th></>}<th>Diagnóstico</th></tr></thead><tbody>{visible.map((item) => {
          const audit = auditItem(item, mode);
          return <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : ''} onClick={() => setSelectedId(item.id)}>
            <td><b>{item.row.descricao || item.row.codigo || `Linha ${item.row.__row}`}</b>{item.row.codigo && item.row.descricao && <small className="table-sub">{item.row.codigo}</small>}</td>
            {mode !== 'cest' && mode !== 'ibs-cbs' && <td>{audit.ncmLabel}</td>}
            {mode !== 'ncm' && mode !== 'ibs-cbs' && <td>{audit.cestLabel}</td>}
            {mode !== 'ncm' && mode !== 'cest' && <><td>{item.result.resolved.cClassTrib?.cst || normalizeDigits(item.row.cst) || '—'}</td><td>{item.result.resolved.cClassTrib?.codigo || normalizeDigits(item.row.cClassTrib) || '—'}</td></>}
            <td><Badge value={audit.needsReview ? 'revisão' : audit.needsAttention ? 'atenção' : 'resolvido'} /></td>
          </tr>;
        })}</tbody></table></div>
      </div>
      {selected && <AuditDetail item={selected} mode={mode} onConfirmNcm={confirmNcmSuggestion} onConfirmCest={confirmCestSuggestion} />}
    </>}
  </>;
}

function AuditDetail({ item, mode, onConfirmNcm, onConfirmCest }: { item: BatchWorkItem; mode: AnalysisMode; onConfirmNcm: (item: BatchWorkItem, ncm: string) => void; onConfirmCest: (item: BatchWorkItem, cest: string) => void }) {
  const audit = auditItem(item, mode);
  const classCandidates = item.result.candidates.cClassTrib;
  const ncmCandidates = item.result.candidates.ncm;
  const cestCandidates = audit.cestMatches;
  return <div className="card audit-detail">
    <div className="inspector-head"><div><small>Item selecionado</small><h2>{item.row.descricao || item.row.codigo || `Linha ${item.row.__row}`}</h2></div><Badge value={audit.needsReview ? 'revisão' : audit.needsAttention ? 'atenção' : 'resolvido'} /></div>
    <div className="audit-detail-grid">
      {(mode === 'completa' || mode === 'ncm') && <section><h3>NCM</h3><div className="audit-value"><b>{audit.ncmLabel}</b>{audit.ncmCode && <button className="copy-mini" onClick={() => navigator.clipboard?.writeText(audit.ncmCode)}>Copiar</button>}</div><p>{item.result.resolved.ncm ? 'Código reconhecido na base fiscal local.' : item.result.decision}</p></section>}
      {(mode === 'completa' || mode === 'cest') && <section><h3>CEST</h3><div className="audit-value"><b>{audit.cestLabel}</b>{normalizeDigits(item.row.cest).length === 7 && <button className="copy-mini" onClick={() => navigator.clipboard?.writeText(normalizeDigits(item.row.cest))}>Copiar</button>}</div><p>{audit.cestMessage}</p></section>}
      {(mode === 'completa' || mode === 'ibs-cbs') && <section><h3>IBS/CBS</h3><div className="copy-grid"><span>CST <b>{item.result.resolved.cClassTrib?.cst || normalizeDigits(item.row.cst) || '—'}</b><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(item.result.resolved.cClassTrib?.cst || normalizeDigits(item.row.cst))}>Copiar</button></span><span>cClassTrib <b>{item.result.resolved.cClassTrib?.codigo || normalizeDigits(item.row.cClassTrib) || '—'}</b><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(item.result.resolved.cClassTrib?.codigo || normalizeDigits(item.row.cClassTrib))}>Copiar</button></span></div><p>{audit.ibsMessage}</p></section>}
    </div>

    {(mode === 'completa' || mode === 'ncm') && !item.result.resolved.ncm && ncmCandidates.length > 0 && <div className="audit-options"><h3>NCM vigentes sugeridos</h3><p>Se o código informado foi extinto ou está incorreto, o Sol usa a descrição do produto para apontar candidatos da base vigente. Quando houver mais de uma opção, confirme antes de alterar o cadastro.</p><div className="option-grid">{ncmCandidates.slice(0, 12).map((candidate) => <div className="audit-option" key={candidate.code}><div><b>{formatNcm(candidate.code)}</b><Badge value={candidate.confidence} /></div><p>{candidate.label || candidate.reason}</p><div className="inline-actions"><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(normalizeDigits(candidate.code))}>Copiar NCM</button><button className="secondary small" onClick={() => onConfirmNcm(item, candidate.code)}>Usar após conferência</button></div></div>)}</div></div>}

    {(mode === 'completa' || mode === 'cest') && cestCandidates.length > 0 && <div className="audit-options"><h3>CEST relacionados ao NCM</h3><p>Ordenados pela compatibilidade entre a abrangência NCM/SH e, quando existe, a descrição do produto.</p><div className="option-grid">{cestCandidates.slice(0, 12).map((match) => <div className="audit-option" key={`${match.item.cest}-${match.item.ncm}`}><div><b>{formatCest(match.item.cest)}</b><Badge value={match.confidence} /></div><small>NCM/SH {match.item.ncm}</small><p>{match.item.descricao}</p><div className="inline-actions"><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(normalizeDigits(match.item.cest))}>Copiar CEST</button><button className="secondary small" onClick={() => onConfirmCest(item, match.item.cest)}>Usar após conferência</button></div></div>)}</div></div>}

    {(mode === 'completa' || mode === 'ibs-cbs') && classCandidates.length > 0 && <div className="audit-options"><h3>Alternativas cClassTrib</h3><p>O Sol não escolhe sozinho quando há mais de uma hipótese fiscal. As opções abaixo são ordenadas por compatibilidade textual com o produto.</p><div className="option-grid">{classCandidates.map((candidate) => <div className="audit-option" key={`${candidate.code}-${candidate.data?.cst}`}><div><b>{candidate.data?.cst}/{candidate.code}</b><Badge value={candidate.confidence} /></div><small>Compatibilidade {candidate.data?.compatibilidade || 'não calculada'}</small><p>{candidate.data?.rotulo && <><b>{candidate.data.rotulo}. </b></>}{candidate.reason}</p><div className="inline-actions"><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(candidate.data?.cst || '')}>Copiar CST</button><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(candidate.code)}>Copiar cClassTrib</button></div></div>)}</div></div>}
  </div>;
}

function auditItem(item: BatchWorkItem, mode: AnalysisMode = 'completa') {
  const ncm = normalizeDigits(item.row.ncm);
  const ncmValid = Boolean(item.result.resolved.ncm);
  const cest = normalizeDigits(item.row.cest);
  const cestMatches = ncmValid ? findCestForNcm(coreContext.cest, ncm, item.row.descricao || '') : [];
  const cestProvided = Boolean(cest);
  const cestValid = cestProvided ? isCestCompatible(coreContext.cest, ncm, cest) : false;
  const classResolved = item.result.status === 'validado' && Boolean(item.result.resolved.cClassTrib);
  const providedCst = normalizeDigits(item.row.cst).slice(0, 3);
  const providedClass = normalizeDigits(item.row.cClassTrib).slice(0, 6);
  const resolvedCst = normalizeDigits(item.result.resolved.cClassTrib?.cst).slice(0, 3);
  const resolvedClass = normalizeDigits(item.result.resolved.cClassTrib?.codigo).slice(0, 6);
  const ibsMismatch = classResolved && (
    (providedCst && providedCst !== resolvedCst)
    || (providedClass && providedClass !== resolvedClass)
  );
  const ibsMessage = ibsMismatch
    ? `A lista informou ${providedCst || 'CST —'} / ${providedClass || 'cClassTrib —'}, mas o motor calculou ${resolvedCst || '—'} / ${resolvedClass || '—'}. Revise antes de alterar o cadastro.`
    : item.result.decision;

  const suggested = item.result.candidates.ncm[0];
  const ncmLabel = ncmValid ? formatNcm(ncm) : ncm ? `${formatNcm(ncm)} • não vigente/não localizado` : suggested ? `${formatNcm(suggested.code)} • sugerido, revisar` : 'Não informado';
  let cestLabel = '—';
  let cestMessage = 'Nenhum CEST foi informado e a base não relaciona CEST a este NCM.';
  if (!ncmValid) {
    cestLabel = 'Aguardando NCM';
    cestMessage = 'Primeiro valide o NCM; depois o Sol consegue cruzar os CEST relacionados.';
  } else if (cestProvided && cestValid) {
    cestLabel = `${formatCest(cest)} • compatível`;
    cestMessage = 'O CEST informado está entre os códigos cuja abrangência NCM/SH inclui este NCM.';
  } else if (cestProvided) {
    cestLabel = `${formatCest(cest)} • revisar`;
    cestMessage = cestMatches.length ? `O CEST informado não aparece entre os ${cestMatches.length} candidatos encontrados para este NCM.` : 'O CEST informado não foi relacionado a este NCM na base local.';
  } else if (cestMatches.length) {
    cestLabel = `${cestMatches.length} opção(ões)`;
    cestMessage = 'Existem CEST relacionados ao NCM. Isso não significa que um CEST seja obrigatório: confirme mercadoria, UF e incidência de ICMS-ST.';
  }

  const ncmReview = !ncmValid;
  const cestReview = !ncmValid || (cestProvided && !cestValid)
    || (!cestProvided && cestMatches.length > 0 && item.cestDecision !== 'nao-aplicavel');
  const cestAttention = false; // CEST sem decisão e com candidatos agora integra a fila de Revisão.
  const ibsReview = !ncmValid || !classResolved || ibsMismatch;

  const reviewRequired = mode === 'ncm'
    ? ncmReview
    : mode === 'cest'
      ? cestReview
      : mode === 'ibs-cbs'
        ? ibsReview
        : needsReview(coreContext, item) || ncmReview || cestReview || ibsReview;
  const needsAttention = !reviewRequired && (mode === 'cest' || mode === 'completa') && cestAttention;
  return { needsReview: reviewRequired, needsAttention, ncmLabel, ncmCode: ncmValid ? ncm : '', cestLabel, cestMessage, cestMatches, ibsMismatch, ibsMessage };
}
