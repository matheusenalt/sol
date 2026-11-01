export type Page =
  | 'cClassTrib'
  | 'NCM'
  | 'CEST'
  | 'CNPJ'
  | 'Análise em lote'
  | 'Revisão'
  | 'Histórico'
  | 'Atualizações'
  | 'Configurações';

export const pages: Page[] = [
  'cClassTrib',
  'Revisão',
  'Análise em lote',
  'NCM',
  'CEST',
  'CNPJ',
  'Histórico',
  'Atualizações',
  'Configurações',
];

export const subtitles: Record<Page, string> = {
  cClassTrib: 'Motor principal: adicionar/importar produtos, resolver automaticamente e revisar apenas as alternativas necessárias.',
  NCM: 'Validação offline de código NCM.',
  CEST: 'Consulta auxiliar; não participa do motor IBS/CBS.',
  CNPJ: 'Consulta preparada para cache local e fonte online.',
  'Análise em lote': 'Auditoria fiscal de NCM, CEST, CST IBS/CBS e cClassTrib em PDF, Excel, CSV ou TXT.',
  Revisão: 'Fila de decisões que não devem ser automatizadas.',
  Histórico: 'Empresas, status Pronto/Em configuração e rastro local das decisões.',
  Atualizações: 'Versões, integridade e evolução das bases fiscais.',
  Configurações: 'Preferências locais e limites operacionais.',
};
