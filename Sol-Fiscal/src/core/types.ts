export type Confidence = 'alta' | 'média' | 'baixa' | 'indeterminada';
export type CoreStatus = 'validado' | 'revisão';
export type SourceState = 'local' | 'cache' | 'oficial' | 'fallback';

export type FiscalInput = {
  codigo?: string;
  descricao?: string;
  ncm?: string;
  cest?: string;
  cst?: string;
  cClassTrib?: string;
  /** Decisão explícita do operador para NCM com múltiplas opções. */
  manualConfirmed?: boolean;
};

export type NcmItem = {
  codigo: string;
  descricao?: string;
  inicioVigencia?: string;
  fimVigencia?: string | null;
};

export type CestItem = {
  cest: string;
  ncm: string;
  descricao: string;
};

export type ClassTribItem = {
  cst: string;
  cClassTrib: string;
  descricao: string;
  dfe?: string;
  inicioVigencia?: string;
  fimVigencia?: string;
  fundamento?: string;
  fonte?: string;
};

export type CoreRule = {
  id: string;
  ncm?: string;
  keywords?: string[];
  cst: string;
  cClassTrib: string;
  fundamento: string;
  inicioVigencia?: string;
  fimVigencia?: string;
};

export type FiscalCatalogOption = {
  r?: string;
  cst?: string;
  cc?: string;
  an?: string;
  red?: string;
  base?: string;
};

export type FiscalCatalogSpecial = {
  s?: string;
  cst?: string;
  cc?: string;
  an?: string;
  red?: string;
  base?: string;
  n?: number;
};

export type FiscalCatalog = {
  id: string;
  date: string;
  source?: string;
  official: string[];
  special: Record<string, FiscalCatalogSpecial>;
  options: Record<string, FiscalCatalogOption[]>;
};

export type Candidate = {
  code: string;
  label: string;
  secondary?: string;
  score: number;
  confidence: Confidence;
  reason: string;
  data?: Record<string, string | undefined>;
};

export type SolCoreContext = {
  ncm: NcmItem[];
  cest: CestItem[];
  classtrib: ClassTribItem[];
  rules: CoreRule[];
  fiscalCatalog?: FiscalCatalog;
  baseVersions?: Record<string, string>;
};

export type FiscalResult = {
  engineVersion: string;
  status: CoreStatus;
  confidence: Confidence;
  input: FiscalInput;
  resolved: {
    ncm: null | {
      codigo: string;
      codigoFormatado: string;
      descricao?: string;
      validated: true;
    };
    cest: null | {
      codigo: string;
      descricao: string;
      ncm: string;
      validated: true;
    };
    cClassTrib: null | {
      codigo: string;
      cst: string;
      descricao: string;
      fundamento?: string;
      dfe?: string;
      validated: true;
    };
  };
  candidates: {
    ncm: Candidate[];
    cest: Candidate[];
    cClassTrib: Candidate[];
  };
  warnings: string[];
  decision: string;
  sources?: Record<string, string>;
};

export type BatchRow = FiscalInput & {
  __row: number;
};

export type BatchResult = {
  row: BatchRow;
  result: FiscalResult;
};

export type BatchWorkItem = BatchResult & {
  id: string;
  original: BatchRow;
  applied: boolean;
  appliedBy?: 'motor' | 'manual';
  editedAt?: string;
  reviewDecision?: 'aceito' | 'ignorado';
  /** Revisão explícita de inexistência de CEST aplicável à mercadoria/operação. */
  cestDecision?: 'nao-aplicavel';
};
