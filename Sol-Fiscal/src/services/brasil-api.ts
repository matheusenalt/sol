export type OnlineNcm = {
  codigo: string;
  descricao: string;
  data_inicio?: string;
  data_fim?: string;
  tipo_ato?: string;
  numero_ato?: string;
  ano_ato?: string;
};

const BASE = 'https://brasilapi.com.br/api';

async function searchNcmRequest(term: string): Promise<OnlineNcm[]> {
  const response = await fetch(`${BASE}/ncm/v1?search=${encodeURIComponent(term)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Consulta NCM indisponível (${response.status}).`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function searchNcmOnline(term: string): Promise<OnlineNcm[]> {
  const clean = term.trim();
  if (!clean) return [];

  const direct = await searchNcmRequest(clean);
  if (direct.length) return uniqueNcms(direct).slice(0, 80);

  const tokens = clean
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .sort((a, b) => b.length - a.length);
  const fallbacks = [...new Set(tokens.slice(0, 3))];
  if (!fallbacks.length) return [];

  const settled = await Promise.allSettled(fallbacks.map((query) => searchNcmRequest(query)));
  const rows = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  return uniqueNcms(rows).slice(0, 80);
}

export async function getNcmOnline(code: string): Promise<OnlineNcm | null> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 8) return null;
  const response = await fetch(`${BASE}/ncm/v1/${encodeURIComponent(clean)}`, {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Consulta NCM indisponível (${response.status}).`);
  return response.json();
}

function uniqueNcms(rows: OnlineNcm[]): OnlineNcm[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = String(row.codigo || '').replace(/\D/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
