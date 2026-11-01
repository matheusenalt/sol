/**
 * Referência pública conhecida no momento desta build.
 *
 * Não é uma consulta online: serve para deixar explícita a versão normativa
 * contra a qual a base embarcada foi conferida. Atualizações continuam sendo
 * uma operação deliberada, auditável e com rollback.
 */
export const officialFiscalReference = {
  cClassTrib: {
    document: 'Informe Técnico 2025.002 v1.70',
    publishedAt: '2026-10-01',
    title: 'Tabela de Classificação Tributária do IBS e CBS',
    source: 'Portal Nacional da NF-e / SVRS',
  },
} as const;
