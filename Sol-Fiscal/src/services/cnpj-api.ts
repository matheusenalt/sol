import { invoke } from '@tauri-apps/api/core';
import { validateCnpj } from '../core/cnpj';

export type StateRegistration = {
  inscricao_estadual: string;
  uf?: string;
  ativo?: boolean;
  regime?: string;
};

export type OnlineCnpj = {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  cnae_fiscal?: string;
  cnae_fiscal_descricao?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  email?: string | null;
  porte?: string;
  natureza_juridica?: string;
  inscricoes_estaduais?: StateRegistration[];
  provider: string;
  cached: boolean;
  data_updated_at?: string | null;
};

export async function getCnpjOnline(value: string, forceRefresh = false): Promise<OnlineCnpj | null> {
  const validation = validateCnpj(value);
  if (!validation.valid) throw new Error(validation.reason || 'CNPJ inválido.');
  return invoke<OnlineCnpj | null>('query_cnpj', { cnpj: validation.clean, forceRefresh });
}
