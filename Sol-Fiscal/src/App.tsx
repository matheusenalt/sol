import { checkFiscalUpdate, installFiscalUpdate, type FiscalUpdate } from './services/fiscal-updater';
import { needsReview } from './core/review';
import { coreContext } from './data/loaders';
import { loadNcmDescriptions } from './data/ncm-reference';
import { useEffect, useState } from 'react';
import type { BatchWorkItem } from './core/types';
import { initDatabase } from './database/history';
import { activateWorkspace, clearWorkspace, loadWorkspace, reopenWorkspace, type WorkspaceStatus } from './database/workspace';
import { BatchPage } from './pages/BatchPage';
import { CestPage } from './pages/CestPage';
import { ClassTribPage } from './pages/ClassTribPage';
import { CnpjPage } from './pages/CnpjPage';
import { HistoryPage } from './pages/HistoryPage';
import { NcmPage } from './pages/NcmPage';
import { pages, subtitles, type Page } from './pages/navigation';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpdatesPage } from './pages/UpdatesPage';

export default function App() {
  const [page, setPage] = useState<Page>('cClassTrib');
  const [theme, setTheme] = useState(localStorage.getItem('sol-theme') || 'light');
  const [notice, setNotice] = useState('');
  const [fiscalUpdate, setFiscalUpdate] = useState<FiscalUpdate | null>(null);
  const [updatingFiscal, setUpdatingFiscal] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchWorkItem[]>([]);
  const [batchFileName, setBatchFileName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus>('em_configuracao');
  const [finalizedAt, setFinalizedAt] = useState<string | undefined>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sol-theme', theme);
  }, [theme]);

  useEffect(() => {
    initDatabase()
      .then(() => loadWorkspace())
      .then((workspace) => {
        if (!workspace) return;
        setBatchRows(workspace.rows);
        setBatchFileName(workspace.fileName);
        setCompanyName(workspace.companyName);
        setWorkspaceStatus(workspace.status);
        setFinalizedAt(workspace.finalizedAt);
      })
      .catch(() => undefined);
  }, []);

  function loadIntoApp(workspace: Awaited<ReturnType<typeof activateWorkspace>>) {
    setBatchRows(workspace.rows);
    setBatchFileName(workspace.fileName);
    setCompanyName(workspace.companyName);
    setWorkspaceStatus(workspace.status);
    setFinalizedAt(workspace.finalizedAt);
    setPage('cClassTrib');
  }

  async function openArchivedWorkspace(sessionId: string) {
    try {
      const workspace = await activateWorkspace(sessionId);
      loadIntoApp(workspace);
      setNotice(workspace.status === 'pronto'
        ? `${workspace.companyName}: empresa pronta aberta em modo somente leitura.`
        : `${workspace.companyName}: lote reaberto com ${workspace.rows.length} produto(s).`);
    } catch (error) {
      setNotice(`Não foi possível abrir o lote: ${String(error)}`);
    }
  }

  async function reopenArchivedWorkspace(sessionId: string) {
    try {
      const workspace = await reopenWorkspace(sessionId);
      loadIntoApp(workspace);
      setNotice(`${workspace.companyName}: configuração reaberta para edição.`);
    } catch (error) {
      setNotice(`Não foi possível reabrir para edição: ${String(error)}`);
    }
  }

  async function newCompany() {
    await clearWorkspace().catch(() => undefined);
    setBatchRows([]);
    setBatchFileName('');
    setCompanyName('');
    setWorkspaceStatus('em_configuracao');
    setFinalizedAt(undefined);
    setPage('cClassTrib');
    setNotice('Pronto para iniciar uma nova empresa.');
  }

  useEffect(() => { loadNcmDescriptions(false).catch(() => null); }, []);
  useEffect(() => {
    let active = true;
    void checkFiscalUpdate().then((result) => {
      if (active && result?.available) setFiscalUpdate(result);
    }).catch(() => { /* GitHub offline: non-blocking. */ });
    return () => { active = false; };
  }, []);

  async function applyFiscalUpdate(update: FiscalUpdate) {
    if (!window.confirm(`Atualizar Sol Fiscal para ${update.latestVersion}? O instalador será verificado por SHA-256. Salve alterações antes de continuar.`)) return;
    setUpdatingFiscal(true);
    try { await installFiscalUpdate(update.latestVersion); }
    catch (error) { setNotice(`Não foi possível instalar a atualização: ${String(error)}`); setUpdatingFiscal(false); }
  }


  const readyLocked = workspaceStatus === 'pronto' && batchRows.length > 0;
  const visiblePages = readyLocked ? pages.filter((item) => item !== 'Revisão' && item !== 'Análise em lote') : pages;
  const pendingCount = batchRows.filter((row) => needsReview(coreContext, row)).length;

  return <div className="shell">
    <aside className="main-sidebar">
      <div className="brand"><img src="/brand/sol-logo-yellow.png" alt="Sol Fiscal" /><div><b>Sol Fiscal</b></div></div>
      <nav>{visiblePages.map((item: Page) => <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}{item === 'Revisão' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</button>)}</nav>
      <div className="aside-foot"><button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Tema claro' : '◐ Tema escuro'}</button></div>
    </aside>

    <main>
      <header><div><h1>{page}</h1><p>{subtitles[page as Page]}</p></div><div className="base-pill">● Base fiscal ativa</div></header>
      {fiscalUpdate?.available && <div className="notice update-notice" role="status">
        <div><b>Sol Fiscal {fiscalUpdate.latestVersion} disponível</b><p>{fiscalUpdate.notes}</p></div>
        <div className="inline-actions"><button className="primary" disabled={updatingFiscal} onClick={() => void applyFiscalUpdate(fiscalUpdate)}>{updatingFiscal ? 'Baixando e verificando…' : 'Atualizar agora'}</button><button className="secondary" disabled={updatingFiscal} onClick={() => setFiscalUpdate(null)}>Agora não</button></div>
      </div>}
      {notice && <div className="notice" onClick={() => setNotice('')}>{notice}</div>}
      <section className="content">
        {page === 'cClassTrib' && <ClassTribPage onNotice={setNotice} rows={batchRows} setRows={setBatchRows} fileName={batchFileName} setFileName={setBatchFileName} companyName={companyName} setCompanyName={setCompanyName} workspaceStatus={workspaceStatus} setWorkspaceStatus={setWorkspaceStatus} finalizedAt={finalizedAt} setFinalizedAt={setFinalizedAt} onGoReview={() => setPage('Revisão')} />}
        {page === 'NCM' && <NcmPage />}
        {page === 'CEST' && <CestPage />}
        {page === 'CNPJ' && <CnpjPage />}
        {page === 'Análise em lote' && !readyLocked && <BatchPage rows={batchRows} setRows={setBatchRows} fileName={batchFileName} setFileName={setBatchFileName} companyName={companyName} setCompanyName={setCompanyName} onNotice={setNotice} onGoReview={() => setPage('Revisão')} />}
        {page === 'Revisão' && !readyLocked && <ReviewPage rows={batchRows} setRows={setBatchRows} fileName={batchFileName} companyName={companyName} onNotice={setNotice} onBackBatch={() => setPage('cClassTrib')} />}
        {page === 'Histórico' && <HistoryPage onOpenWorkspace={openArchivedWorkspace} onReopenWorkspace={reopenArchivedWorkspace} onNewCompany={newCompany} />}
        {page === 'Atualizações' && <UpdatesPage />}
        {page === 'Configurações' && <SettingsPage />}
      </section>
    </main>
  </div>;
}
