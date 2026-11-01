import { invoke } from '@tauri-apps/api/core';
import type { BatchWorkItem } from '../core/types';
import { coreContext } from '../data/loaders';
import { decodeBatchSnapshot, encodeBatchSnapshot, isBatchSnapshotComplete } from '../core/session-snapshot';

export type WorkspaceStatus = 'em_configuracao' | 'pronto';

export type WorkspaceSummary = {
  id: string;
  company_name: string;
  file_name: string;
  total_items: number;
  status: WorkspaceStatus;
  finalized_at?: string;
  created_at?: string;
  updated_at?: string;
};

type SessionRecord = {
  id: string;
  company_name: string;
  file_name: string;
  payload: string;
  status: WorkspaceStatus;
  finalized_at?: string;
  created_at?: string;
  updated_at?: string;
};

const BROWSER_SESSIONS_KEY = 'sol-fiscal-sessions-v4';
const BROWSER_ACTIVE_KEY = 'sol-fiscal-active-session-v4';

function isBrowserPreview(): boolean {
  return !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

function encodeRows(rows: BatchWorkItem[]): string {
  return encodeBatchSnapshot(rows, coreContext);
}

function decodeRows(payload: string, status: WorkspaceStatus): BatchWorkItem[] {
  return decodeBatchSnapshot(coreContext, payload, status === 'pronto' ? 'freeze' : 'refresh');
}

function browserSessions(): SessionRecord[] {
  const current = localStorage.getItem(BROWSER_SESSIONS_KEY);
  if (current) return JSON.parse(current);
  // Migra preview das versões anteriores sem perder lotes locais.
  const legacy = JSON.parse(localStorage.getItem('sol-fiscal-sessions-v3') || '[]') as Partial<SessionRecord>[];
  const migrated = legacy.map((item) => ({ ...item, status: 'em_configuracao' as const })) as SessionRecord[];
  if (migrated.length) writeBrowserSessions(migrated);
  return migrated;
}

function writeBrowserSessions(sessions: SessionRecord[]) {
  localStorage.setItem(BROWSER_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 500)));
}

function snapshot(record: SessionRecord) {
  return {
    sessionId: record.id,
    fileName: record.file_name || '',
    companyName: record.company_name || '',
    status: record.status || 'em_configuracao' as WorkspaceStatus,
    finalizedAt: record.finalized_at,
    rows: decodeRows(record.payload, record.status || 'em_configuracao'),
  };
}

export function createSessionId(companyName: string): string {
  const slug = companyName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'empresa';
  return `${Date.now()}-${slug}`;
}

export async function startWorkspace(fileName: string, rows: BatchWorkItem[], companyName: string): Promise<string> {
  const id = createSessionId(companyName);
  const record: SessionRecord = {
    id,
    company_name: companyName.trim() || 'Empresa não identificada',
    file_name: fileName,
    payload: encodeRows(rows),
    status: 'em_configuracao',
  };

  if (isBrowserPreview()) {
    const now = new Date().toISOString();
    const sessions = browserSessions();
    sessions.unshift({ ...record, created_at: now, updated_at: now });
    writeBrowserSessions(sessions);
    localStorage.setItem(BROWSER_ACTIVE_KEY, id);
    return id;
  }
  await invoke('save_session', { state: record });
  return id;
}

export async function saveWorkspace(fileName: string, rows: BatchWorkItem[], companyName = ''): Promise<void> {
  if (isBrowserPreview()) {
    const active = localStorage.getItem(BROWSER_ACTIVE_KEY) || '';
    if (!active) {
      if (companyName) await startWorkspace(fileName, rows, companyName);
      return;
    }
    const sessions = browserSessions();
    const index = sessions.findIndex((item) => item.id === active);
    if (index < 0) return;
    if (sessions[index].status === 'pronto') throw new Error('Empresa finalizada. Reabra pelo Histórico para editar.');
    sessions[index] = {
      ...sessions[index],
      company_name: companyName || sessions[index].company_name,
      file_name: fileName || sessions[index].file_name,
      payload: encodeRows(rows),
      updated_at: new Date().toISOString(),
    };
    writeBrowserSessions(sessions);
    return;
  }
  await invoke('update_active_session', { fileName, companyName, payload: encodeRows(rows) });
}

export async function renameActiveCompany(companyName: string): Promise<void> {
  const clean = companyName.trim();
  if (!clean) throw new Error('Informe o nome da empresa.');
  if (isBrowserPreview()) {
    const active = localStorage.getItem(BROWSER_ACTIVE_KEY) || '';
    const sessions = browserSessions();
    const index = sessions.findIndex((item) => item.id === active);
    if (index < 0) return;
    if (sessions[index].status === 'pronto') throw new Error('Empresa finalizada. Reabra pelo Histórico para editar.');
    sessions[index] = { ...sessions[index], company_name: clean, updated_at: new Date().toISOString() };
    writeBrowserSessions(sessions);
    return;
  }
  await invoke('rename_active_company', { companyName: clean });
}

export async function finalizeWorkspace(): Promise<{ status: WorkspaceStatus; finalizedAt?: string }> {
  if (isBrowserPreview()) {
    const active = localStorage.getItem(BROWSER_ACTIVE_KEY) || '';
    const sessions = browserSessions();
    const index = sessions.findIndex((item) => item.id === active);
    if (index < 0) throw new Error('Nenhum lote ativo.');
    const snapshotRows = decodeRows(sessions[index].payload, sessions[index].status || 'em_configuracao');
    if (!isBatchSnapshotComplete(snapshotRows, coreContext)) {
      throw new Error('Ainda existem produtos sem NCM/CST/cClassTrib concluídos ou com combinação CST/cClassTrib incoerente.');
    }
    const now = new Date().toISOString();
    sessions[index] = { ...sessions[index], status: 'pronto', finalized_at: now, updated_at: now };
    writeBrowserSessions(sessions);
    return { status: 'pronto', finalizedAt: now };
  }
  const record = await invoke<SessionRecord>('finalize_active_session');
  return { status: record.status, finalizedAt: record.finalized_at };
}

export async function loadWorkspace(): Promise<{ sessionId: string; fileName: string; companyName: string; status: WorkspaceStatus; finalizedAt?: string; rows: BatchWorkItem[] } | null> {
  let record: SessionRecord | null;
  if (isBrowserPreview()) {
    const active = localStorage.getItem(BROWSER_ACTIVE_KEY) || localStorage.getItem('sol-fiscal-active-session-v3') || '';
    record = browserSessions().find((item) => item.id === active) || null;
    if (record && !localStorage.getItem(BROWSER_ACTIVE_KEY)) localStorage.setItem(BROWSER_ACTIVE_KEY, active);
  } else {
    record = await invoke<SessionRecord | null>('load_active_session');
  }
  return record?.payload ? snapshot(record) : null;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  if (isBrowserPreview()) {
    return browserSessions().map((item) => ({
      id: item.id,
      company_name: item.company_name,
      file_name: item.file_name,
      total_items: (JSON.parse(item.payload || '[]') as unknown[]).length,
      status: item.status || 'em_configuracao',
      finalized_at: item.finalized_at,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
  }
  return invoke('list_sessions');
}

export async function activateWorkspace(sessionId: string): Promise<{ sessionId: string; fileName: string; companyName: string; status: WorkspaceStatus; finalizedAt?: string; rows: BatchWorkItem[] }> {
  let record: SessionRecord;
  if (isBrowserPreview()) {
    const found = browserSessions().find((item) => item.id === sessionId);
    if (!found) throw new Error('Lote não encontrado.');
    record = found;
    localStorage.setItem(BROWSER_ACTIVE_KEY, sessionId);
  } else {
    record = await invoke<SessionRecord>('activate_session', { sessionId });
  }
  return snapshot(record);
}

export async function reopenWorkspace(sessionId: string): Promise<{ sessionId: string; fileName: string; companyName: string; status: WorkspaceStatus; finalizedAt?: string; rows: BatchWorkItem[] }> {
  let record: SessionRecord;
  if (isBrowserPreview()) {
    const sessions = browserSessions();
    const index = sessions.findIndex((item) => item.id === sessionId);
    if (index < 0) throw new Error('Lote não encontrado.');

    // Congela primeiro o que estava efetivamente finalizado. Isso é essencial
    // para lotes antigos, que ainda não possuíam `result` dentro do payload.
    const frozenRows = decodeRows(sessions[index].payload, sessions[index].status || 'em_configuracao');
    sessions[index] = {
      ...sessions[index],
      payload: encodeRows(frozenRows),
      status: 'em_configuracao',
      finalized_at: undefined,
      updated_at: new Date().toISOString(),
    };
    writeBrowserSessions(sessions);
    localStorage.setItem(BROWSER_ACTIVE_KEY, sessionId);
    record = sessions[index];
  } else {
    // O registro é lido enquanto ainda está `pronto`, portanto lotes legados
    // são reconstruídos em modo freeze antes que o backend remova o bloqueio.
    const before = await invoke<SessionRecord>('activate_session', { sessionId });
    const frozenRows = decodeRows(before.payload, before.status || 'em_configuracao');
    record = await invoke<SessionRecord>('reopen_session', { sessionId });
    const frozenPayload = encodeRows(frozenRows);
    await invoke('update_active_session', {
      fileName: record.file_name,
      companyName: record.company_name,
      payload: frozenPayload,
    });
    record = { ...record, payload: frozenPayload };
  }
  return snapshot(record);
}

export async function clearWorkspace(): Promise<void> {
  if (isBrowserPreview()) {
    localStorage.removeItem(BROWSER_ACTIVE_KEY);
    return;
  }
  await invoke('clear_active_session');
}
