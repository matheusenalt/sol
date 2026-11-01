import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Empty } from '../components/Empty';
import { clearHistory, historyCompany, listHistory, type HistoryEntry } from '../database/history';
import { listWorkspaces, type WorkspaceSummary } from '../database/workspace';

type Props = {
  onOpenWorkspace: (sessionId: string) => Promise<void>;
  onReopenWorkspace: (sessionId: string) => Promise<void>;
  onNewCompany: () => Promise<void>;
};

export function HistoryPage({ onOpenWorkspace, onReopenWorkspace, onNewCompany }: Props) {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [lots, setLots] = useState<WorkspaceSummary[]>([]);
  const [company, setCompany] = useState('todos');
  const [opening, setOpening] = useState('');

  function load() {
    Promise.all([listHistory(), listWorkspaces()])
      .then(([historyRows, workspaces]) => { setRows(historyRows); setLots(workspaces); })
      .catch(() => { setRows([]); setLots([]); });
  }
  useEffect(load, []);

  const companies = useMemo<string[]>(() => Array.from(new Set<string>([
    ...rows.map(historyCompany),
    ...lots.map((item) => item.company_name || 'Sem empresa'),
  ])).sort((a, b) => a.localeCompare(b)), [rows, lots]);
  const visible = company === 'todos' ? rows : rows.filter((row) => historyCompany(row) === company);
  const visibleLots = company === 'todos' ? lots : lots.filter((lot) => lot.company_name === company);

  async function clear() {
    if (!window.confirm('Apagar o registro de ações? Os lotes arquivados das empresas continuarão salvos.')) return;
    await clearHistory();
    load();
  }

  async function openLot(id: string) {
    setOpening(`view:${id}`);
    try { await onOpenWorkspace(id); }
    finally { setOpening(''); }
  }

  async function reopenLot(lot: WorkspaceSummary) {
    if (!window.confirm(`Reabrir ${lot.company_name} para edição? O status “Pronto” será removido até você finalizar novamente.`)) return;
    setOpening(`edit:${lot.id}`);
    try { await onReopenWorkspace(lot.id); }
    finally { setOpening(''); }
  }

  return <div className="history-page-stack">
    <div className="card">
      <div className="toolbar">
        <div><h2>Empresas</h2><span>Cada empresa fica isolada. Empresas prontas abrem em modo somente leitura.</span></div>
        <div className="history-actions"><select value={company} onChange={(e) => setCompany(e.target.value)}><option value="todos">Todas as empresas</option>{companies.map((name) => <option key={name} value={name}>{name}</option>)}</select><button className="primary" onClick={onNewCompany}>Nova empresa</button></div>
      </div>
      {visibleLots.length ? <div className="company-lot-grid">{visibleLots.map((lot) => <div className={`company-lot ${lot.status === 'pronto' ? 'company-lot-ready' : ''}`} key={lot.id}>
        <div><div className="company-lot-title"><b>{lot.company_name || 'Sem empresa'}</b><Badge value={lot.status === 'pronto' ? 'pronto' : 'configurando'} /></div><span>{lot.file_name || 'Cadastro manual'}</span><small>{lot.total_items} produto(s){lot.finalized_at ? ` • finalizada em ${lot.finalized_at}` : ''}</small></div>
        <div className="company-lot-actions"><button className="secondary" disabled={opening === `view:${lot.id}`} onClick={() => openLot(lot.id)}>{opening === `view:${lot.id}` ? 'Abrindo...' : lot.status === 'pronto' ? 'Ver empresa' : 'Abrir lote'}</button>{lot.status === 'pronto' && <button className="primary" disabled={opening === `edit:${lot.id}`} onClick={() => reopenLot(lot)}>{opening === `edit:${lot.id}` ? 'Reabrindo...' : 'Reabrir para editar'}</button>}</div>
      </div>)}</div> : <Empty>Nenhuma empresa arquivada para este filtro.</Empty>}
    </div>

    <div className="card">
      <div className="toolbar"><div><h2>Registro de ações</h2><span>Importações, revisões, finalizações e exportações identificadas pela empresa.</span></div><button className="danger" onClick={clear}>Apagar registro</button></div>
      {visible.length ? visible.map((row) => <div className="history" key={String(row.id)}><b>{historyCompany(row)} · {row.kind}</b><span>{row.summary}</span><small>{row.created_at || ''}</small></div>) : <Empty>Nenhum registro para esta empresa.</Empty>}
    </div>
  </div>;
}
