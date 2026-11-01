import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { applyCestReviewDecision, applyManualFiscalEdit, applyReviewedNcmCorrection } from '../core/batch-engine';
import { needsReview, reviewIssueLabels } from '../core/review';
import { findCestForNcm } from '../core/cest';
import { formatCest } from '../core/normalize';
import { formatNcm, normalizeDigits } from '../core/normalize';
import type { BatchWorkItem } from '../core/types';
import { coreContext } from '../data/loaders';
import { saveHistory } from '../database/history';
import { saveWorkspace } from '../database/workspace';

type Props = {
  rows: BatchWorkItem[];
  setRows: (rows: BatchWorkItem[]) => void;
  fileName: string;
  companyName: string;
  onNotice: (message: string) => void;
  onBackBatch: () => void;
};

export function ReviewPage({ rows, setRows, fileName, companyName, onNotice, onBackBatch }: Props) {
  const pending = useMemo(
    () => rows.filter((item) => needsReview(coreContext, item) && item.reviewDecision !== 'ignorado'),
    [rows],
  );
  const ignored = rows.filter((item) => needsReview(coreContext, item) && item.reviewDecision === 'ignorado');
  const [selectedId, setSelectedId] = useState('');
  const selected = pending.find((item) => item.id === selectedId) || pending[0] || null;
  const [manualNcm, setManualNcm] = useState('');
  const [manualCst, setManualCst] = useState('');
  const [manualClass, setManualClass] = useState('');
  const [manualCest, setManualCest] = useState('');
  const cestOptions = selected?.result.resolved.ncm
    ? findCestForNcm(coreContext.cest, selected.row.ncm || '', selected.row.descricao || '').slice(0, 15) : [];

  useEffect(() => {
    if (!selected) return;
    setManualNcm(formatNcm(selected.row.ncm || ''));
    setManualCst('');
    setManualClass('');
    setManualCest(formatCest(selected.row.cest || ''));
  }, [selected?.id]);

  function acceptClassCandidate(code: string, cst?: string) {
    if (!selected) return;
    const nextItem = applyManualFiscalEdit(coreContext, selected, {
      ncm: selected.row.ncm,
      cst: cst || '',
      cClassTrib: code,
    });
    persist(nextItem, 'opção fiscal confirmada');
  }

  function acceptClassCandidateForSameNcm(code: string, cst?: string) {
    if (!selected || !cst) return;
    const ncm = normalizeDigits(selected.row.ncm);
    const targets = rows.filter((item) => item.result.status === 'revisão' && normalizeDigits(item.row.ncm) === ncm);
    if (!targets.length) return;
    if (!window.confirm(`Aplicar CST ${cst} / cClassTrib ${code} a ${targets.length} produto(s) com NCM ${formatNcm(ncm)}?`)) return;
    const ids = new Set(targets.map((item) => item.id));
    const nextRows = rows.map((item) => ids.has(item.id)
      ? applyManualFiscalEdit(coreContext, item, { ncm: item.row.ncm, cst, cClassTrib: code })
      : item);
    setRows(nextRows);
    saveWorkspace(fileName, nextRows, companyName).catch((error) => onNotice(`Falha ao salvar revisão: ${String(error)}`));
    setSelectedId('');
    saveHistory({
      kind: 'revisão cClassTrib em massa',
      summary: `${companyName} • ${targets.length} itens • NCM ${formatNcm(ncm)} • ${cst}/${code}`,
      payload: JSON.stringify({ company: companyName, ncm, cst, cClassTrib: code, quantidade: targets.length }),
    }).catch(() => undefined);
    onNotice(`${targets.length} produto(s) resolvidos com a mesma alternativa.`);
  }

  function applyNcmCandidate(code: string) {
    if (!selected) return;
    const keepManual = Boolean(selected.row.manualConfirmed && selected.row.cst && selected.row.cClassTrib)
      && window.confirm('Há CST e cClassTrib preenchidos manualmente. Ao mudar o NCM, deseja manter essa escolha e CONFIRMAR NOVAMENTE sua adequação ao novo NCM? Cancelar limpa a escolha anterior e recalcula o tratamento fiscal.');
    const nextItem = applyReviewedNcmCorrection(coreContext, selected, code, keepManual);
    persist(nextItem, nextItem.result.status === 'validado' ? 'NCM corrigido e resolvido pelo motor' : 'NCM corrigido; ainda exige escolha fiscal');
  }

  function applyCestDecision(cest: string | null) {
    if (!selected) return;
    if (cest === null && !window.confirm('Registrar que não há CEST aplicável para este produto? A ausência de CEST deve ser conferida conforme mercadoria, operação e UF.')) return;
    try {
      const next = applyCestReviewDecision(coreContext, selected, cest);
      persist(next, cest === null ? 'CEST revisado: não aplicável' : `CEST ${formatCest(cest)} confirmado`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function applyManualCest() {
    const cest = normalizeDigits(manualCest);
    if (cest.length !== 7) { onNotice('CEST deve conter 7 dígitos ou use Não aplicável.'); return; }
    applyCestDecision(cest);
  }

  function applyManualNcm() {
    if (!selected) return;
    const ncm = normalizeDigits(manualNcm);
    if (ncm.length !== 8 || ncm === '00000000') {
      onNotice('Informe um NCM válido de 8 dígitos.');
      return;
    }
    applyNcmCandidate(ncm);
  }

  function applyManualClass(sameNcm = false) {
    if (!selected) return;
    const cst = normalizeDigits(manualCst);
    const cClassTrib = normalizeDigits(manualClass);
    if (cst.length !== 3 || cClassTrib.length !== 6) {
      onNotice('Informe CST com 3 dígitos e cClassTrib com 6 dígitos.');
      return;
    }
    if (cClassTrib.slice(0, 3) !== cst) {
      onNotice(`Combinação incoerente: cClassTrib ${cClassTrib} não corresponde ao CST ${cst}.`);
      return;
    }
    if (!sameNcm) {
      const nextItem = applyManualFiscalEdit(coreContext, selected, { ncm: selected.row.ncm, cst, cClassTrib });
      persist(nextItem, `classificação manual ${cst}/${cClassTrib}`);
      return;
    }

    const ncm = normalizeDigits(selected.row.ncm);
    const targets = rows.filter((item) => item.result.status === 'revisão' && normalizeDigits(item.row.ncm) === ncm);
    if (!targets.length) return;
    if (!window.confirm(`Aplicar manualmente CST ${cst} / cClassTrib ${cClassTrib} a ${targets.length} produto(s) com NCM ${formatNcm(ncm)}?`)) return;
    const ids = new Set(targets.map((item) => item.id));
    const nextRows = rows.map((item) => ids.has(item.id)
      ? applyManualFiscalEdit(coreContext, item, { ncm: item.row.ncm, cst, cClassTrib })
      : item);
    setRows(nextRows);
    saveWorkspace(fileName, nextRows, companyName).catch((error) => onNotice(`Falha ao salvar revisão: ${String(error)}`));
    setSelectedId('');
    saveHistory({
      kind: 'classificação manual em massa',
      summary: `${companyName} • ${targets.length} itens • NCM ${formatNcm(ncm)} • ${cst}/${cClassTrib}`,
      payload: JSON.stringify({ company: companyName, ncm, cst, cClassTrib, quantidade: targets.length, manual: true }),
    }).catch(() => undefined);
    onNotice(`${targets.length} produto(s) resolvidos manualmente.`);
  }

  function persist(nextItem: BatchWorkItem, decision: string) {
    if (!selected) return;
    const nextRows = rows.map((item) => item.id === selected.id ? nextItem : item);
    setRows(nextRows);
    saveWorkspace(fileName, nextRows, companyName).catch((error) => onNotice(`Falha ao salvar revisão: ${String(error)}`));
    setSelectedId('');
    saveHistory({
      kind: 'revisão',
      summary: `${companyName} • ${nextItem.row.codigo || ''} ${nextItem.row.descricao || 'Produto'} • ${decision}`.trim(),
      payload: JSON.stringify({ company: companyName, before: selected.row, after: nextItem.row, result: nextItem.result }),
    }).catch(() => undefined);
    const faltam = reviewIssueLabels(coreContext, nextItem);
    onNotice(faltam.length ? `Alteração salva. Ainda falta revisar: ${faltam.join(', ')}.` : 'Item resolvido e removido da fila.');
  }

  function ignoreSelected() {
    if (!selected || !window.confirm('Remover este item da fila sem alterar os dados?')) return;
    const nextRows = rows.map((item) => item.id === selected.id ? { ...item, reviewDecision: 'ignorado' as const } : item);
    setRows(nextRows);
    saveWorkspace(fileName, nextRows, companyName).catch((error) => onNotice(`Falha ao salvar revisão: ${String(error)}`));
    setSelectedId('');
    onNotice('Item removido da fila de revisão.');
  }

  if (!rows.length) {
    return <div className="card"><div className="toolbar"><h2>Fila de revisão</h2><button className="secondary" onClick={onBackBatch}>Ir para cClassTrib</button></div><Empty>Importe um lote para iniciar.</Empty></div>;
  }
  function restoreIgnored(id: string) {
    const nextRows = rows.map((item) => item.id === id ? { ...item, reviewDecision: undefined } : item);
    setRows(nextRows);
    saveWorkspace(fileName, nextRows, companyName).catch((error) => onNotice(`Falha ao salvar revisão: ${String(error)}`));
    setSelectedId(id);
    onNotice('Item restaurado para a revisão.');
  }

  if (!pending.length) {
    return <div className="card"><div className="toolbar"><h2>Fila de revisão</h2><button className="secondary" onClick={onBackBatch}>Voltar ao cClassTrib</button></div>
      {ignored.length ? <><p>{ignored.length} item(ns) foram ignorados, mas ainda estão pendentes e impedem finalizar a empresa.</p>
        {ignored.map((item) => <div className="review-ignored-row" key={item.id}><span>{item.row.codigo || ''} {item.row.descricao || 'Produto'} — {reviewIssueLabels(coreContext, item).join(', ')}</span><button className="secondary" onClick={() => restoreIgnored(item.id)}>Restaurar revisão</button></div>)}
      </> : <Empty>Todo o lote está resolvido. Nada exige decisão manual.</Empty>}</div>;
  }

  return (
    <div className="review-layout">
      <div className="card review-list">
        <div className="toolbar"><div><h2>Fila de revisão</h2><span>{pending.length} item(ns) com pendência em NCM, CEST, CST ou cClassTrib.</span></div><button className="secondary" onClick={onBackBatch}>Voltar ao cClassTrib</button></div>
        {pending.map((item) => (
          <button key={item.id} className={`review-row ${selected?.id === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
            <div><b>{item.row.codigo || `Linha ${item.row.__row}`}</b><span>{item.row.descricao || 'Sem descrição'}</span></div>
            <div><small>{reviewIssueLabels(coreContext, item).join(' • ')}</small><Badge value="revisão" /></div>
          </button>
        ))}
      </div>

      <div className="card review-detail">
        {selected && <>
          <div className="result-head"><div><small>Produto em revisão</small><h2>{selected.row.codigo || `Linha ${selected.row.__row}`}</h2></div><Badge value="revisão" /></div>
          <p>{selected.row.descricao || 'Sem descrição informada.'}</p>
          <p className="decision">{selected.result.decision}</p>
          <div className="review-summary-grid">
            <span><small>NCM</small><b>{formatNcm(selected.row.ncm || '') || 'Pendente'}</b></span>
            <span><small>CEST</small><b>{formatCest(selected.row.cest || '') || (selected.cestDecision === 'nao-aplicavel' ? 'Não aplicável' : 'Pendente')}</b></span>
            <span><small>CST IBS/CBS</small><b>{selected.row.cst || 'Pendente'}</b></span>
            <span><small>cClassTrib</small><b>{selected.row.cClassTrib || 'Pendente'}</b></span>
          </div>
          <p className="muted compact"><b>Revisar:</b> {reviewIssueLabels(coreContext, selected).join(', ')}</p>

          {ignored.length > 0 && <details className="review-ignored-list"><summary>{ignored.length} item(ns) ignorados (continuam pendentes para exportação/finalização)</summary>
            {ignored.map((item) => <div className="review-ignored-row" key={item.id}><span>{item.row.codigo || ''} {item.row.descricao || 'Produto'}</span><button className="secondary" onClick={() => restoreIgnored(item.id)}>Restaurar revisão</button></div>)}
          </details>}
          <section className="review-candidates">
            <h3>1. NCM</h3>
            <div className="input-actions"><input value={manualNcm} onChange={(event) => setManualNcm(event.target.value)} placeholder="0000.00.00" /><button className="secondary" onClick={applyManualNcm}>Reanalisar</button></div>
            {selected.result.candidates.ncm.length > 0 && <div className="candidate-stack">{selected.result.candidates.ncm.slice(0, 6).map((candidate) => (
              <button key={candidate.code} className="candidate-button" onClick={() => applyNcmCandidate(candidate.code)}><span><code>{formatNcm(candidate.code)}</code> <Badge value={candidate.confidence} /></span><small>{candidate.label || candidate.reason}</small></button>
            ))}</div>}
          </section>

          <section className="review-candidates">
            <h3>2. CEST</h3>
            <p className="muted compact">CEST por NCM é somente uma lista de possibilidades; confirme descrição, mercadoria, operação e UF. Não indica ICMS-ST automaticamente.</p>
            {selected.result.resolved.ncm ? <>
              <div className="input-actions"><input value={manualCest} onChange={(event) => setManualCest(event.target.value)} placeholder="00.000.00" /><button className="secondary" onClick={applyManualCest}>Confirmar CEST</button></div>
              <div className="alternative-actions"><button className="secondary" onClick={() => applyCestDecision(null)}>Não aplicável / sem CEST</button></div>
              {cestOptions.length > 0 && <div className="candidate-stack">{cestOptions.map((option) => (
                <button key={`${option.item.cest}-${option.item.ncm}`} className="candidate-button" onClick={() => applyCestDecision(option.item.cest)}>
                  <span><code>{formatCest(option.item.cest)}</code> <Badge value={option.confidence} /></span>
                  <small>{option.item.descricao} — abrangência NCM {option.item.ncm}</small>
                </button>
              ))}</div>}
            </> : <div className="warning-block">Confirme o NCM na etapa 1 para consultar os CEST relacionados.</div>}
          </section>

          {selected.result.candidates.cClassTrib.length > 0 ? <section className="review-candidates">
            <h3>3. CST IBS/CBS e cClassTrib — alternativas</h3>
            <p className="muted compact">O motor mostra as opções possíveis; você decide a correta para esse produto.</p>
            {selected.result.candidates.cClassTrib.map((candidate) => (
              <div key={`${candidate.code}-${candidate.data?.cst}`} className="alternative-card review-alternative-card">
                <div className="alternative-head"><div><b>cClassTrib {candidate.code}</b><span>CST {candidate.data?.cst}</span></div><Badge value="revisão" /></div>
                <p>{candidate.data?.rotulo && <b>{candidate.data.rotulo}. </b>}{candidate.reason}</p>
                {candidate.data?.anexo && <small>{candidate.data.anexo}{candidate.data.reducao ? ` • ${candidate.data.reducao}` : ''}</small>}
                <div className="alternative-actions"><button className="primary" onClick={() => acceptClassCandidate(candidate.code, candidate.data?.cst)}>Aplicar neste produto</button><button className="secondary" onClick={() => acceptClassCandidateForSameNcm(candidate.code, candidate.data?.cst)}>Aplicar a todos deste NCM</button></div>
              </div>
            ))}
          </section> : normalizeDigits(selected.row.ncm).length === 8 ? <section className="review-candidates manual-review-box">
            <h3>3. CST IBS/CBS e cClassTrib — manual</h3>
            <p className="muted compact">Se o NCM estiver correto e o catálogo não trouxer opções, informe CST e cClassTrib manualmente. A decisão fica registrada no histórico.</p>
            <div className="grid2"><label>CST IBS/CBS<input maxLength={3} value={manualCst} onChange={(e) => setManualCst(e.target.value)} placeholder="000" /></label><label>cClassTrib<input maxLength={6} value={manualClass} onChange={(e) => setManualClass(e.target.value)} placeholder="000001" /></label></div>
            <div className="alternative-actions"><button className="primary" onClick={() => applyManualClass(false)}>Aplicar neste produto</button><button className="secondary" onClick={() => applyManualClass(true)}>Aplicar a todos deste NCM</button></div>
          </section> : <div className="warning-block">Corrija o NCM primeiro. Depois o Sol recalcula as alternativas cClassTrib.</div>}

          <details className="manual-classification"><summary>Forçar classificação manual mesmo havendo alternativas</summary><div className="grid2"><label>CST<input maxLength={3} value={manualCst} onChange={(e) => setManualCst(e.target.value)} placeholder="000" /></label><label>cClassTrib<input maxLength={6} value={manualClass} onChange={(e) => setManualClass(e.target.value)} placeholder="000001" /></label></div><button className="secondary wide" onClick={() => applyManualClass(false)}>Confirmar manualmente</button></details>
          <div className="review-actions"><button className="secondary" onClick={onBackBatch}>Voltar ao cClassTrib</button><button className="danger" onClick={ignoreSelected}>Ignorar item</button></div>
        </>}
      </div>
    </div>
  );
}
