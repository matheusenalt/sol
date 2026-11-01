import { invoke } from '@tauri-apps/api/core';

export type HistoryEntry = {
  id?: number;
  kind: string;
  summary: string;
  payload: string;
  created_at?: string;
};

const BROWSER_STORAGE_KEY = 'sol-fiscal-history';

function isBrowserPreview(): boolean {
  return !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export async function initDatabase() {
  if (isBrowserPreview()) return { mode: 'browser-localStorage' };
  return invoke('init_database');
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  if (isBrowserPreview()) {
    const rows: HistoryEntry[] = JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || '[]');
    rows.unshift({ ...entry, id: Date.now(), created_at: new Date().toISOString() });
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(rows.slice(0, 3000)));
    return;
  }
  await invoke('save_history', { entry });
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (isBrowserPreview()) return JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || '[]');
  return invoke('list_history');
}

export async function clearHistory(): Promise<void> {
  if (isBrowserPreview()) {
    localStorage.removeItem(BROWSER_STORAGE_KEY);
    return;
  }
  await invoke('clear_history');
}

export function historyCompany(entry: HistoryEntry): string {
  try {
    const payload = JSON.parse(entry.payload || '{}') as { company?: string };
    return String(payload.company || '').trim() || companyFromSummary(entry.summary) || 'Sem empresa';
  } catch {
    return companyFromSummary(entry.summary) || 'Sem empresa';
  }
}

function companyFromSummary(summary: string): string {
  return String(summary || '').split('•')[0]?.trim() || '';
}
