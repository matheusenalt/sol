import type {
  CestItem,
  ClassTribItem,
  CoreRule,
  FiscalCatalog,
  NcmItem,
  SolCoreContext,
} from '../core/types';
import cestRaw from './cest-data.json';
import classRaw from './classtrib.json';
import rulesRaw from './core-rules.json';
import ncmRaw from './ncm-bootstrap.json';
import fiscalCatalogRaw from './fiscal-catalog.json';
import { loadClassTribOverride } from './classtrib-update';

type NcmSnapshot = {
  metadata: {
    sourceDate?: string;
    recordCount?: number;
  };
  codes: string[];
};

type ClassTribSnapshot = {
  metadata: {
    versaoReferencia?: string;
    publicacao?: string;
    fonte?: string;
    observacao?: string;
  };
  items: ClassTribItem[];
};

type RulesSnapshot = {
  metadata: {
    version?: string;
  };
  rules: CoreRule[];
};

const ncmSnapshot = ncmRaw as NcmSnapshot;
const classTribSnapshot = classRaw as ClassTribSnapshot;
const classTribOverride = loadClassTribOverride();
const rulesSnapshot = rulesRaw as RulesSnapshot;
const fiscalCatalog = fiscalCatalogRaw as FiscalCatalog;

const cest: CestItem[] = [];
flattenCest(cestRaw, cest);

const catalogClasses = buildCatalogClassIndex(fiscalCatalog);
const activeClassTrib = classTribOverride?.items?.length ? classTribOverride.items : (classTribSnapshot.items || []);
const mergedClassTrib = mergeClassTrib(activeClassTrib, catalogClasses);

export const baseMeta = {
  ncm: ncmSnapshot.metadata,
  classtrib: {
    ...classTribSnapshot.metadata,
    fallbackRecords: classTribSnapshot.items.length,
    activeRecords: activeClassTrib.length,
    overrideSourceFile: classTribOverride?.sourceFile,
    overrideImportedAt: classTribOverride?.importedAt,
    overrideChecksum: classTribOverride?.checksum,
    overrideVersion: classTribOverride?.versionLabel,
    catalogVersion: fiscalCatalog.id,
    catalogDate: fiscalCatalog.date,
    catalogRules: Object.keys(fiscalCatalog.special || {}).length,
  },
  cest: {
    name: 'CEST snapshot local',
    recordCount: cest.length,
  },
  rules: rulesSnapshot.metadata,
};

export const coreContext: SolCoreContext = {
  ncm: ncmSnapshot.codes.map((codigo): NcmItem => ({ codigo })),
  cest,
  classtrib: mergedClassTrib,
  rules: rulesSnapshot.rules || [],
  fiscalCatalog,
  baseVersions: {
    ncm: String(ncmSnapshot.metadata?.sourceDate || 'bootstrap'),
    cClassTrib: classTribOverride ? `${classTribOverride.versionLabel} • ${classTribOverride.items.length} registros • ${classTribOverride.sourceFile}` : `${fiscalCatalog.id} • ${fiscalCatalog.date}`, 
    fiscalCatalog: fiscalCatalog.id,
    cest: 'consulta auxiliar',
    rules: String(rulesSnapshot.metadata?.version || '0.1'),
  },
};

function buildCatalogClassIndex(catalog: FiscalCatalog): ClassTribItem[] {
  const rows = new Map<string, ClassTribItem>();

  const add = (cstRaw?: string, ccRaw?: string, fundamento?: string, label?: string) => {
    const cst = String(cstRaw || '').replace(/\D/g, '').slice(0, 3);
    const cClassTrib = String(ccRaw || '').replace(/\D/g, '').slice(0, 6);
    if (!cst || !cClassTrib) return;
    const key = `${cst}:${cClassTrib}`;
    if (!rows.has(key)) {
      rows.set(key, {
        cst,
        cClassTrib,
        descricao: label || fundamento || `CST ${cst} / cClassTrib ${cClassTrib}`,
        fundamento,
        fonte: catalog.id,
      });
    }
  };

  add('000', '000001', 'Tributação integral — sem redução.', 'Tributação integral');
  Object.values(catalog.special || {}).forEach((row) => add(row.cst, row.cc, row.base));
  Object.values(catalog.options || {}).flat().forEach((row) => add(row.cst, row.cc, row.base, row.r));
  return [...rows.values()];
}

function mergeClassTrib(primary: ClassTribItem[], catalog: ClassTribItem[]): ClassTribItem[] {
  const map = new Map<string, ClassTribItem>();
  [...primary, ...catalog].forEach((item) => {
    const key = `${item.cst}:${item.cClassTrib}`;
    const previous = map.get(key);
    map.set(key, previous ? { ...item, ...previous } : item);
  });
  return [...map.values()];
}

function flattenCest(node: unknown, output: CestItem[]) {
  if (Array.isArray(node)) {
    node.forEach((item) => flattenCest(item, output));
    return;
  }

  if (!node || typeof node !== 'object') return;

  const value = node as Record<string, unknown>;
  const cestCode = String(value.cest || value.CEST || '');

  if (cestCode) {
    output.push({
      cest: cestCode,
      ncm: String(value.ncm || value.NCM || ''),
      descricao: String(value.descricao || value['descrição'] || value.Descricao || ''),
    });
  }

  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object') {
      flattenCest(child, output);
    }
  });
}
