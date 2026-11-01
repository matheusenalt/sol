export function friendlyError(error: unknown, context = 'Operação'): string {
  const raw = error instanceof Error ? error.message : String(error);
  console.error(`[Sol Fiscal] ${context}:`, error);

  if (/sqlstate|sql error|exception/i.test(raw)) {
    return `${context} não pôde ser concluída. Consulte os logs técnicos para detalhes.`;
  }

  return raw || `${context} não pôde ser concluída.`;
}
