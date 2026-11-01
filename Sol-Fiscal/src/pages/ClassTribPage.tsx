import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { applyManualFiscalEdit, applyReviewedNcmCorrection, buildBatchWorkItem, refreshBatchWorkItem } from '../core/batch-engine';
import { searchClassTrib } from '../core/engine';
import { needsReview } from '../core/review';
import { loadNcmDescriptions } from '../data/ncm-reference';
import { formatNcm, normalizeDigits, normalizeText } from '../core/normalize';
import type { BatchRow, BatchWorkItem } from '../core/types';
import { coreContext } from '../data/loaders';
import { saveHistory } from '../database/history';
import { clearWorkspace, finalizeWorkspace, renameActiveCompany, saveWorkspace, startWorkspace, type WorkspaceStatus } from '../database/workspace';
import { batchFiscalBase, exportBatch, type ExportFormat } from '../exports/report';
import { readBatchFile } from '../imports/batch';
import { friendlyError } from '../security/errors';

type Props = {
  onNotice: (message: string) => void;
  rows: BatchWorkItem[];
  setRows: (rows: BatchWorkItem[]) => void;
  fileName: string;
  setFileName: (name: string) => void;
  companyName: string;
  setCompanyName: (name: string) => void;
  workspaceStatus: WorkspaceStatus;
  setWorkspaceStatus: (status: WorkspaceStatus) => void;
  finalizedAt?: string;
  setFinalizedAt: (value: string | undefined) => void;
  onGoReview: () => void;
};

type AddForm = { codigo: string; descricao: string; ncm: string };
const emptyAdd: AddForm = { codigo: '', descricao: '', ncm: '' };

export function ClassTribPage({ onNotice, rows, setRows, fileName, setFileName, companyName, setCompanyName, workspaceStatus, setWorkspaceStatus, finalizedAt, setFinalizedAt, onGoReview }: Props) {
  const [mode, setMode] = useState<'motor' | 'tabela'>('motor');
  const [form, setForm] = useState<AddForm>(emptyAdd);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [term, setTerm] = useState('');
  const [tableTerm, setTableTerm] = useState('');
  const [ncmEdit, setNcmEdit] = useState('');
  const [manualCst, setManualCst] = useState('');
  const [manualClass, setManualClass] = useState('');
  const [exporting, setExporting] = useState<ExportFormat | ''>('');
  const [companyDraft, setCompanyDraft] = useState(companyName);

  const selected = rows.find((item) => item.id === selectedId)
    || rows.find((item) => needsReview(coreContext, item))
    || rows[0]
    || null;
  const pending = rows.filter((item) => needsReview(coreContext, item));
  const unresolved = rows.filter((item) => needsReview(coreContext, item));
  const solved = rows.filter((item) => !needsReview(coreContext, item));
  const manual = rows.filter((item) => item.appliedBy === 'manual');
  const snapshotBase = useMemo(() => batchFiscalBase(rows), [rows]);
  const currentFiscalBase = coreContext.baseVersions?.cClassTrib || coreContext.fiscalCatalog?.id || 'base local';
  const needsExplicitReanalysis = rows.some((item) => {
    const sources = item.result.sources || {};
    if (sources.snapshot === 'legado') return true;
    const itemBase = sources.cClassTrib || sources.fiscalCatalog;
    if (!itemBase) return true;
    return itemBase !== currentFiscalBase && itemBase !== coreContext.baseVersions?.fiscalCatalog;
  });
  const tableRows = useMemo(() => searchClassTrib(coreContext.classtrib, tableTerm), [tableTerm]);
  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((item) => [item.row.codigo, item.row.descricao, item.row.ncm, item.row.cst, item.row.cClassTrib]
      .join(' ').toLowerCase().includes(query));
  }, [rows, term]);

  useEffect(() => setCompanyDraft(companyName), [companyName]);

  useEffect(() => {
    if (rows.length && (!selectedId || !rows.some((item) => item.id === selectedId))) {
      setSelectedId(rows.find((item) => needsReview(coreContext, item))?.id || rows[0].id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setNcmEdit(formatNcm(selected.row.ncm || selected.result.resolved.ncm?.codigo || ''));
    setManualCst('');
    setManualClass('');
  }, [selected?.id]);

  async function importFile(file?: File) {
    if (!file) return;
    if (rows.length && !window.confirm(`Abrir uma nova empresa? O lote atual${companyName ? ` de ${companyName}` : ''} continuará no histórico.`)) return;
    setLoading(true);
    try {
      const importedFile = await readBatchFile(file);
      await loadNcmDescriptions(true).catch(() => null);
      let company = importedFile.companyName.trim();
      const fallback = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (!company || company === fallback || company === 'Empresa não identificada') {
        company = window.prompt('Confirme o nome da empresa/cliente deste lote:', company || fallback)?.trim() || '';
      }
      if (!company) throw new Error('Informe a empresa para manter o lote separado dos outros clientes.');

      const stamp = Date.now();
      const imported = importedFile.rows.map((row, index) => buildBatchWorkItem(coreContext, row, `${stamp}-${row.__row}-${index}`));

      // Importação sempre substitui a área de trabalho: nunca mistura duas empresas.
      setRows(imported);
      setFileName(file.name);
      setCompanyName(company);
      setCompanyDraft(company);
      await startWorkspace(file.name, imported, company);
      setSelectedId(imported.find((item) => needsReview(coreContext, item))?.id || imported[0]?.id || '');

      const automaticos = imported.filter((item) => !needsReview(coreContext, item)).length;
      const revisao = imported.length - automaticos;
      await saveHistory({
        kind: 'importação cClassTrib',
        summary: `${company} • ${file.name} • ${imported.length} produto(s)`,
        payload: JSON.stringify({ company, file: file.name, total: imported.length, automaticos, revisao, duplicadosRemovidos: importedFile.duplicatesRemoved, engine: 'Sol Core 0.8.0' }),
      });
      const dup = importedFile.duplicatesRemoved ? ` ${importedFile.duplicatesRemoved} duplicado(s) removido(s).` : '';
      onNotice(`${company}: ${imported.length} produto(s), ${automaticos} resolvidos e ${revisao} para revisão.${dup}`);
    } catch (error) {
      onNotice(friendlyError(error, 'Importação cClassTrib'));
    } finally {
      setLoading(false);
    }
  }

  async function addProduct() {
    const ncm = normalizeDigits(form.ncm);
    if (ncm && (ncm.length !== 8 || ncm === '00000000')) {
      onNotice('Se informar NCM, use 8 dígitos válidos. Você também pode deixar em branco e revisar depois.');
      return;
    }
    if (!ncm && !form.codigo.trim() && !form.descricao.trim()) {
      onNotice('Informe o NCM, o código ou a descrição do produto.');
      return;
    }
    if (isDuplicateManual(form, rows)) {
      onNotice('Este produto já existe no lote atual e não será adicionado novamente.');
      return;
    }

    let company = companyName.trim();
    if (!company) {
      company = window.prompt('Informe a empresa/cliente deste cadastro manual:', '')?.trim() || '';
      if (!company) return;
      setCompanyName(company);
      setCompanyDraft(company);
    }

    const row: BatchRow = {
      __row: rows.length ? Math.max(...rows.map((item) => item.row.__row)) + 1 : 1,
      codigo: form.codigo.trim(), descricao: form.descricao.trim(), ncm, cst: '', cClassTrib: '',
    };
    const item = buildBatchWorkItem(coreContext, row, `manual-${Date.now()}`);
    const nextRows = [...rows, item];
    const activeFile = fileName || 'Produtos adicionados manualmente';
    setRows(nextRows);
    setFileName(activeFile);
    setSelectedId(item.id);
    setForm(emptyAdd);
    if (rows.length === 0) await startWorkspace(activeFile, nextRows, company);
    else await saveWorkspace(activeFile, nextRows, company);
    await saveHistory({
      kind: 'adição cClassTrib',
      summary: `${company} • ${item.row.codigo || ''} ${item.row.descricao || 'Produto'}`.trim(),
      payload: JSON.stringify({ company, result: item.result }),
    }).catch(() => undefined);
  }

  async function saveCompanyName() {
    const clean = companyDraft.trim();
    if (!clean) return;
    setCompanyName(clean);
    await renameActiveCompany(clean).catch(() => undefined);
    await saveWorkspace(fileName, rows, clean).catch(() => undefined);
    await saveHistory({ kind: 'empresa atualizada', summary: clean, payload: JSON.stringify({ company: clean }) }).catch(() => undefined);
    onNotice(`Empresa do lote atual: ${clean}.`);
  }

  async function applyAlternative(code: string, cst?: string, sameNcm = false) {
    if (!selected || !cst) return;
    const sourceNcm = normalizeDigits(selected.row.ncm);
    const targets = sameNcm
      ? rows.filter((item) => needsReview(coreContext, item) && normalizeDigits(item.row.ncm) === sourceNcm)
      : [selected];
    if (!targets.length) return;
    if (sameNcm && !window.confirm(`Aplicar CST ${cst} / cClassTrib ${code} a ${targets.length} produto(s) com NCM ${formatNcm(sourceNcm)}?`)) return;

    const ids = new Set(targets.map((item) => item.id));
    const nextRows = rows.map((item) => ids.has(item.id)
      ? applyManualFiscalEdit(coreContext, item, { ncm: item.row.ncm, cst, cClassTrib: code })
      : item);
    setRows(nextRows);
    await saveWorkspace(fileName, nextRows, companyName).catch(() => undefined);
    await saveHistory({
      kind: sameNcm ? 'alternativa cClassTrib em massa' : 'alternativa cClassTrib',
      summary: `${companyName} • ${targets.length} produto(s) • ${formatNcm(sourceNcm)} • ${cst}/${code}`,
      payload: JSON.stringify({ company: companyName, ncm: sourceNcm, cst, cClassTrib: code, quantidade: targets.length }),
    }).catch(() => undefined);
    onNotice(`${targets.length} produto(s) resolvidos com CST ${cst} / cClassTrib ${code}.`);
  }

  async function applyNcmCorrection() {
    if (!selected) return;
    const ncm = normalizeDigits(ncmEdit);
    if (ncm.length !== 8 || ncm === '00000000') {
      onNotice('Informe um NCM válido de 8 dígitos.');
      return;
    }
    const keepManual = Boolean(selected.row.manualConfirmed && selected.row.cst && selected.row.cClassTrib)
      && window.confirm('Manter CST/cClassTrib manuais e confirmar sua adequação ao novo NCM? Cancelar recalcula a classificação.');
    const updated = applyReviewedNcmCorrection(coreContext, selected, ncm, keepManual);
    await persistSingle(updated, 'NCM corrigido');
  }

  async function confirmManualClassification(sameNcm = false) {
    if (!selected) return;
    const cst = normalizeDigits(manualCst);
    const cClassTrib = normalizeDigits(manualClass);
    if (cst.length !== 3 || cClassTrib.length !== 6) {
      onNotice('Classificação manual: CST precisa ter 3 dígitos e cClassTrib 6 dígitos.');
      return;
    }
    if (cClassTrib.slice(0, 3) !== cst) {
      onNotice(`Combinação incoerente: cClassTrib ${cClassTrib} não corresponde ao CST ${cst}.`);
      return;
    }
    if (sameNcm) {
      const ncm = normalizeDigits(selected.row.ncm);
      const targets = rows.filter((item) => needsReview(coreContext, item) && normalizeDigits(item.row.ncm) === ncm);
      if (!targets.length) return;
      if (!window.confirm(`Aplicar manualmente CST ${cst} / cClassTrib ${cClassTrib} a ${targets.length} produto(s) com NCM ${formatNcm(ncm)}?`)) return;
      const ids = new Set(targets.map((item) => item.id));
      const nextRows = rows.map((item) => ids.has(item.id)
        ? applyManualFiscalEdit(coreContext, item, { ncm: item.row.ncm, cst, cClassTrib })
        : item);
      setRows(nextRows);
      await saveWorkspace(fileName, nextRows, companyName).catch(() => undefined);
      await saveHistory({ kind: 'classificação manual em massa', summary: `${companyName} • ${targets.length} produto(s) • ${formatNcm(ncm)} • ${cst}/${cClassTrib}`, payload: JSON.stringify({ company: companyName, ncm, cst, cClassTrib, quantidade: targets.length }) }).catch(() => undefined);
      onNotice(`${targets.length} produto(s) resolvidos manualmente.`);
      return;
    }
    const updated = applyManualFiscalEdit(coreContext, selected, { ncm: selected.row.ncm, cst, cClassTrib });
    await persistSingle(updated, 'Classificação manual confirmada');
  }

  async function persistSingle(updated: BatchWorkItem, historyLabel: string) {
    if (!selected) return;
    const nextRows = rows.map((item) => item.id === selected.id ? updated : item);
    setRows(nextRows);
    setSelectedId(updated.id);
    await saveWorkspace(fileName, nextRows, companyName).catch(() => undefined);
    await saveHistory({
      kind: 'revisão cClassTrib',
      summary: `${companyName} • ${updated.row.codigo || ''} ${updated.row.descricao || 'Produto'} • ${historyLabel}`.trim(),
      payload: JSON.stringify({ company: companyName, before: selected.row, after: updated.row, result: updated.result }),
    }).catch(() => undefined);
    onNotice(needsReview(coreContext, updated) ? 'Dados registrados. Ainda há pendência em NCM, CEST ou classificação; consulte Revisão.' : 'Produto resolvido e removido da fila.');
  }

  async function exportFile(format: ExportFormat) {
    if (!rows.length) return;
    setExporting(format);
    try {
      const path = await exportBatch(rows, format, fileName || 'cclasstrib', companyName);
      if (!path) { onNotice('Exportação cancelada.'); return; }
      onNotice(`Arquivo ${format.toUpperCase()} salvo em: ${path}`);
      await saveHistory({
        kind: 'exportação',
        summary: `${companyName} • ${format.toUpperCase()} • ${rows.length} produto(s)`,
        payload: JSON.stringify({ company: companyName, format, total: rows.length, path }),
      }).catch(() => undefined);
    } catch (error) {
      onNotice(friendlyError(error, 'Exportação'));
    } finally {
      setExporting('');
    }
  }

  async function reanalyzeWithCurrentBase() {
    if (!rows.length) return;
    if (!window.confirm('Reanalisar este lote inteiro com a base fiscal instalada agora? O snapshot atual será substituído e itens podem voltar para revisão.')) return;
    const nextRows = rows.map((item) => refreshBatchWorkItem(coreContext, item));
    setRows(nextRows);
    await saveWorkspace(fileName, nextRows, companyName);
    const reviewCount = nextRows.filter((item) => needsReview(coreContext, item)).length;
    await saveHistory({
      kind: 'reanálise fiscal explícita',
      summary: `${companyName} • ${nextRows.length} produto(s) • base ${coreContext.baseVersions?.cClassTrib || coreContext.fiscalCatalog?.id || 'local'}`,
      payload: JSON.stringify({ company: companyName, total: nextRows.length, revisao: reviewCount, baseAnterior: snapshotBase, baseNova: coreContext.baseVersions?.cClassTrib }),
    }).catch(() => undefined);
    onNotice(reviewCount
      ? `Lote reanalisado com a base atual. ${reviewCount} item(ns) voltaram para revisão.`
      : 'Lote reanalisado com a base atual. Todos os itens continuam resolvidos.');
  }

  async function finalizeCompany() {
    if (!rows.length) return;
    if (unresolved.length) { onNotice(`Ainda existem ${unresolved.length} item(ns) sem classificação concluída. Resolva todos antes de finalizar.`); return; }
    if (!companyName.trim()) { onNotice('Informe o nome da empresa antes de finalizar.'); return; }
    if (!window.confirm(`Finalizar ${companyName}? Depois disso este lote ficará somente para exportação. Para editar novamente, use Histórico.`)) return;
    try {
      await saveWorkspace(fileName, rows, companyName);
      const result = await finalizeWorkspace();
      setWorkspaceStatus('pronto');
      setFinalizedAt(result.finalizedAt);
      await saveHistory({ kind: 'empresa finalizada', summary: `${companyName} • ${rows.length} produto(s) • configuração cClassTrib concluída`, payload: JSON.stringify({ company: companyName, total: rows.length, finalizedAt: result.finalizedAt, engine: rows[0]?.result.engineVersion, fiscalBase: snapshotBase }) }).catch(() => undefined);
      onNotice(`${companyName}: configuração finalizada. A empresa agora está pronta.`);
    } catch (error) { onNotice(friendlyError(error, 'Finalização da empresa')); }
  }

  async function clearAll() {
    if (!rows.length || !window.confirm('Fechar o lote atual? O histórico continuará salvo por empresa.')) return;
    setRows([]); setSelectedId(''); setFileName(''); setCompanyName(''); setCompanyDraft(''); setWorkspaceStatus('em_configuracao'); setFinalizedAt(undefined);
    await clearWorkspace().catch(() => undefined);
    onNotice('Lote fechado. O histórico foi preservado.');
  }

  async function searchNcmWeb() {
    if (!selected) return;
    const query = [selected.row.descricao, ncmEdit ? `NCM ${ncmEdit}` : 'NCM'].filter(Boolean).join(' ');
    try {
      const isTauri = Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
      if (isTauri) await invoke('open_web_search', { query });
      else window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
    } catch (error) { onNotice(friendlyError(error, 'Pesquisa NCM')); }
  }

  if (workspaceStatus === 'pronto' && rows.length > 0) {
    return <div className="ready-company card">
      <div className="ready-mark">✓</div>
      <div className="ready-copy"><span className="ready-kicker">Empresa pronta</span><h2>{companyName}</h2><p>A configuração de cClassTrib foi concluída e está bloqueada contra alterações acidentais.</p><div className="ready-meta"><span>{rows.length} produto(s)</span><span>{manual.length} decisão(ões) manual(is)</span><span>Base do snapshot: {snapshotBase}</span>{finalizedAt && <span>Finalizada: {finalizedAt}</span>}</div><div className="ready-note">Para verificar ou modificar classificações, abra <b>Histórico</b>, localize esta empresa e use <b>Reabrir para editar</b>. Atualizações futuras da base não alteram este resultado automaticamente.</div></div>
      <div className="ready-actions"><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('xlsx')}>Excel…</button><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('csv')}>CSV…</button><button className="primary" disabled={Boolean(exporting)} onClick={() => exportFile('pdf')}>PDF…</button></div>
    </div>;
  }

  if (mode === 'tabela') {
    return <><div className="tabs"><button onClick={() => setMode('motor')}>Motor cClassTrib</button><button className="active">Consultar tabela</button></div><div className="card"><div className="table-context"><div><b>Consulta de cClassTrib embarcada</b><span>{coreContext.classtrib.length} combinações de consulta • motor fiscal cobre {coreContext.fiscalCatalog?.official.length || coreContext.ncm.length} NCMs</span></div><p>Esta tela não mede o tamanho do motor: ela lista as combinações cClassTrib embarcadas para consulta/manual. O motor usa também o catálogo NCM→tratamento fiscal e envia casos contextuais para revisão.</p></div><div className="toolbar"><input value={tableTerm} onChange={(event) => setTableTerm(event.target.value)} placeholder="Código, CST, descrição ou fundamento" /><span>{tableRows.length} resultado(s)</span></div><div className="table-wrap"><table><thead><tr><th>cClassTrib</th><th>CST</th><th>Descrição</th><th>Fundamento</th><th></th></tr></thead><tbody>{tableRows.map((row) => <tr key={`${row.cst}-${row.cClassTrib}`}><td><code>{row.cClassTrib}</code></td><td>{row.cst}</td><td>{row.descricao}</td><td>{row.fundamento || '—'}</td><td><button className="copy-mini" onClick={() => navigator.clipboard?.writeText(row.cClassTrib)}>Copiar</button></td></tr>)}</tbody></table></div></div></>;
  }

  return <>
    <div className="tabs"><button className="active">Motor cClassTrib</button><button onClick={() => setMode('tabela')}>Consultar tabela</button></div>
    <div className="classtrib-intro"><div><h2>Motor cClassTrib</h2><p>Cada empresa tem seu próprio lote. O motor resolve o determinístico e deixa só NCM/alternativas para revisão.</p></div><div className="engine-pill">Catálogo local • {coreContext.fiscalCatalog?.date || 'offline'}</div></div>

    {rows.length > 0 && <div className="company-context card"><div><small>Empresa / cliente deste lote</small><b>{companyName || 'Empresa não identificada'}</b><span>Origem: {fileName || 'Cadastro manual'}</span></div><div className="company-edit"><input value={companyDraft} onChange={(e) => setCompanyDraft(e.target.value)} placeholder="Nome da empresa" /><button className="secondary" onClick={saveCompanyName}>Salvar nome</button></div></div>}

    {rows.length > 0 && needsExplicitReanalysis && <div className="warning-block"><b>Snapshot preservado de outra base</b><p>Este lote está usando <b>{snapshotBase}</b>. A base instalada agora é <b>{currentFiscalBase}</b>. Nada foi alterado automaticamente.</p><button className="secondary" onClick={reanalyzeWithCurrentBase}>Reanalisar lote com a base atual</button></div>}

    <div className="classtrib-add-grid">
      <div className="card"><h2>Adicionar produto</h2><div className="grid3"><label>Código<input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Opcional" /></label><label className="span2">Produto / descrição <small className="label-help">opcional, mas recomendado para aumentar a confiabilidade</small><input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: papel higiênico folha dupla" /></label></div><div className="input-actions"><input value={form.ncm} onChange={(e) => setForm({ ...form, ncm: e.target.value })} placeholder="NCM • 0000.00.00" /><button className="primary" onClick={addProduct}>Adicionar e analisar</button></div></div>
      <div className="card compact-import-card"><div className="drop compact-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFile(e.dataTransfer.files?.[0]); }}><input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" onChange={(e) => importFile(e.target.files?.[0])} /><b>{loading ? 'Lendo e classificando...' : 'Adicionar PDF, Excel, CSV ou TXT'}</b><span>O Sol tenta identificar a empresa no cabeçalho, remove duplicados e abre um lote independente.</span></div></div>
    </div>

    {rows.length === 0 ? <div className="card"><Empty>Importe um arquivo ou adicione um produto para iniciar.</Empty></div> : <div className="classtrib-workspace">
      <div className="card classtrib-list-card">
        <div className="metrics classtrib-metrics"><div><b>{rows.length}</b><span>Total</span></div><div><b>{solved.length}</b><span>Resolvidos</span></div><div><b>{pending.length}</b><span>Revisão</span></div><div><b>{manual.length}</b><span>Manuais</span></div></div>
        <div className="batch-toolbar"><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar produto, código, NCM, CST, cClassTrib..." /><button className="secondary" onClick={onGoReview} disabled={!pending.length}>Revisão ({pending.length})</button><button className="secondary" onClick={clearAll}>Fechar lote</button></div>
        <div className="export-inline"><span>{unresolved.length ? `${unresolved.length} item(ns) ainda não têm classificação concluída.` : 'Tudo resolvido. Finalize a empresa para travar a configuração.'}</span><div className="button-row"><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('xlsx')}>Excel…</button><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('csv')}>CSV…</button><button className="secondary" disabled={Boolean(exporting)} onClick={() => exportFile('pdf')}>PDF…</button>{!unresolved.length && <button className="primary" onClick={finalizeCompany}>Finalizar empresa</button>}</div></div>
        <div className="table-wrap classtrib-table-wrap"><table className="selectable-table"><thead><tr><th>Produto</th><th>NCM</th><th>CST</th><th>cClassTrib</th><th>Status</th></tr></thead><tbody>{visible.slice(0, 1500).map((item) => <tr key={item.id} className={selected?.id === item.id ? 'selected-row' : ''} onClick={() => setSelectedId(item.id)}><td><b>{item.row.descricao || item.row.codigo || `Linha ${item.row.__row}`}</b>{item.row.codigo && item.row.descricao && <small className="table-sub">{item.row.codigo}</small>}</td><td>{item.result.resolved.ncm?.codigoFormatado || formatNcm(item.row.ncm) || '—'}</td><td>{item.result.resolved.cClassTrib?.cst || '—'}</td><td>{item.result.resolved.cClassTrib?.codigo || '—'}</td><td><Badge value={needsReview(coreContext, item) ? 'revisão' : 'resolvido'} /></td></tr>)}</tbody></table></div>
      </div>

      <aside className="card classtrib-review-panel">{selected ? <><div className="inspector-head"><div><small>Produto</small><h2>{selected.row.descricao || selected.row.codigo || `Linha ${selected.row.__row}`}</h2></div><Badge value={needsReview(coreContext, selected) ? 'revisão' : 'resolvido'} /></div>{selected.row.codigo && <p className="muted compact">Código: {selected.row.codigo}</p>}
        {selected.result.status === 'validado' ? <div className="resolved-panel inspector-section"><h3>Classificação resolvida</h3><dl><dt>NCM</dt><dd><span className="copy-field"><b>{selected.result.resolved.ncm?.codigoFormatado}</b><button className="copy-mini" title="Copiar NCM" onClick={() => navigator.clipboard?.writeText(selected.result.resolved.ncm?.codigo || '')}>Copiar</button></span></dd><dt>CST IBS/CBS</dt><dd><span className="copy-field"><b>{selected.result.resolved.cClassTrib?.cst}</b><button className="copy-mini" title="Copiar CST" onClick={() => navigator.clipboard?.writeText(selected.result.resolved.cClassTrib?.cst || '')}>Copiar</button></span></dd><dt>cClassTrib</dt><dd><span className="copy-field"><b>{selected.result.resolved.cClassTrib?.codigo}</b><button className="copy-mini" title="Copiar cClassTrib" onClick={() => navigator.clipboard?.writeText(selected.result.resolved.cClassTrib?.codigo || '')}>Copiar</button></span></dd><dt>Regra</dt><dd>{selected.result.resolved.cClassTrib?.fundamento || selected.result.decision}</dd></dl><p className="success-note">NCM e CST/cClassTrib resolvidos. {needsReview(coreContext, selected) ? 'Ainda existe revisão de CEST: abra a fila de Revisão.' : 'Nenhuma decisão adicional pendente.'}</p>{needsReview(coreContext, selected) && <button className="secondary" onClick={onGoReview}>Revisar CEST deste produto</button>}</div> : <>
          <div className="inspector-section"><h3>1. NCM</h3><div className="input-actions"><input value={ncmEdit} onChange={(e) => setNcmEdit(e.target.value)} placeholder="0000.00.00" /><button className="secondary" onClick={applyNcmCorrection}>Reanalisar</button></div><button className="link-button" onClick={searchNcmWeb}>Pesquisar NCM na web</button></div>
          {selected.result.candidates.ncm.length > 0 && <div className="inspector-section"><h3>NCM sugeridos</h3>{selected.result.candidates.ncm.slice(0, 6).map((candidate) => <button className="candidate-button" key={candidate.code} onClick={() => setNcmEdit(formatNcm(candidate.code))}><span><code>{formatNcm(candidate.code)}</code> <Badge value={candidate.confidence} /></span><small>{candidate.label || candidate.reason}</small></button>)}</div>}
          {selected.result.candidates.cClassTrib.length > 0 && <div className="inspector-section"><h3>2. Escolha a alternativa cClassTrib</h3><div className="alternative-list">{selected.result.candidates.cClassTrib.map((candidate) => <div className="alternative-card" key={`${candidate.code}-${candidate.data?.cst}`}><div className="alternative-head"><div><b>cClassTrib {candidate.code}</b><span>CST {candidate.data?.cst}</span></div><div className="alternative-score"><Badge value={candidate.confidence} />{candidate.data?.compatibilidade && <small>Compatibilidade {candidate.data.compatibilidade}</small>}</div></div><p>{candidate.data?.rotulo && <b>{candidate.data.rotulo}. </b>}{candidate.reason}</p><div className="alternative-actions"><button className="primary" onClick={() => applyAlternative(candidate.code, candidate.data?.cst)}>Aplicar neste produto</button><button className="secondary" onClick={() => applyAlternative(candidate.code, candidate.data?.cst, true)}>Aplicar a todos deste NCM</button></div></div>)}</div></div>}
          {selected.result.candidates.cClassTrib.length === 0 && normalizeDigits(selected.row.ncm).length === 8 ? <div className="inspector-section manual-review-box"><h3>2. Sem alternativa automática</h3><p className="muted compact">Se o NCM estiver correto, informe CST e cClassTrib manualmente. Essa decisão fica registrada no histórico.</p><div className="grid2"><label>CST<input maxLength={3} value={manualCst} onChange={(e) => setManualCst(e.target.value)} placeholder="000" /></label><label>cClassTrib<input maxLength={6} value={manualClass} onChange={(e) => setManualClass(e.target.value)} placeholder="000001" /></label></div><div className="alternative-actions"><button className="primary" onClick={() => confirmManualClassification(false)}>Aplicar neste produto</button><button className="secondary" onClick={() => confirmManualClassification(true)}>Aplicar a todos deste NCM</button></div></div> : selected.result.candidates.cClassTrib.length > 0 ? <details className="manual-classification"><summary>Classificação manual / exceção</summary><div className="grid2"><label>CST<input maxLength={3} value={manualCst} onChange={(e) => setManualCst(e.target.value)} placeholder="000" /></label><label>cClassTrib<input maxLength={6} value={manualClass} onChange={(e) => setManualClass(e.target.value)} placeholder="000001" /></label></div><button className="secondary wide" onClick={() => confirmManualClassification(false)}>Confirmar classificação manual</button></details> : <div className="warning-block">Corrija o NCM primeiro. Depois o motor recalcula cClassTrib.</div>}
        </>}</> : <Empty>Selecione um produto.</Empty>}</aside>
    </div>}
  </>;
}

function isDuplicateManual(form: AddForm, rows: BatchWorkItem[]): boolean {
  const code = normalizeText(form.codigo);
  const description = normalizeText(form.descricao);
  const ncm = normalizeDigits(form.ncm);
  return rows.some((item) => {
    const itemCode = normalizeText(item.row.codigo || '');
    if (code && itemCode) return code === itemCode;
    return Boolean(description) && description === normalizeText(item.row.descricao || '') && ncm === normalizeDigits(item.row.ncm);
  });
}
