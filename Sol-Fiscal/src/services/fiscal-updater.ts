import { invoke, isTauri } from '@tauri-apps/api/core';

export interface FiscalUpdate {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  notes: string;
  tag: string;
}

const LAST_CHECK = 'sol-fiscal-updater-last-check-v1';
const DAY = 24 * 60 * 60 * 1000;

/** Exactly one scheduled check per rolling 24h; manual checks do not consume quota. */
export async function checkFiscalUpdate(manual = false): Promise<FiscalUpdate | null> {
  if (!isTauri()) return null;
  if (!manual) {
    const last = Number(localStorage.getItem(LAST_CHECK) || 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last >= 0 && Date.now() - last < DAY) return null;
    // Record before the request: offline failures must not cause a startup retry loop.
    localStorage.setItem(LAST_CHECK, String(Date.now()));
  }
  return invoke<FiscalUpdate>('check_fiscal_update');
}

/** Call only after visible, explicit user confirmation. */
export async function installFiscalUpdate(version: string): Promise<void> {
  if (!isTauri()) throw new Error('A instalação automática requer o aplicativo Windows.');
  return invoke<void>('install_fiscal_update', { expectedVersion: version });
}
