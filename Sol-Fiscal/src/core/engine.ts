import type {
  Candidate,
  ClassTribItem,
  FiscalCatalog,
  FiscalCatalogOption,
  FiscalInput,
  FiscalResult,
  SolCoreContext,
} from './types.js';
import {
  formatNcm,
  normalizeDigits,
  normalizeText,
  textScore,
} from './normalize.js';

const officialSetCache = new WeakMap<FiscalCatalog, Set<string>>();

function officialNcmSet(catalog: FiscalCatalog): Set<string> {
  const cached = officialSetCache.get(catalog);
  if (cached) return cached;
  const created = new Set(catalog.official.map(normalizeDigits));
  officialSetCache.set(catalog, created);
  return created;
}

// Índice lexical com resultados por descrição e códigos vigentes. Este mecanismo
// PRODUZ HIPÓTESES: NCM sem origem não vira validado nem é gravado sem escolha.
type NcmSearchIndex = {
  list: SolCoreContext['ncm'];
  entries: { item: SolCoreContext['ncm'][number]; words: Set<string> }[];
  inverted: Map<string, Set<number>>;
  results: Map<string, Candidate[]>;
};
const ncmSearchCache = new WeakMap<SolCoreContext, NcmSearchIndex>();
const ALIASES: Record<string, string[]> = {
  gas: ['gaseificadas', 'gaseificados', 'gasosas', 'carbonatadas'],
  agua: ['aguas', 'mineral', 'minerais'],
  aguas: ['agua'],
  refrigerante: ['refrigerantes', 'bebidas', 'gasosas'],
  cerveja: ['cervejas', 'malte'],
  empada: ['pasteis', 'pastelaria', 'padaria', 'recheados'],
  frango: ['aves', 'galinha', 'carne'],
  hamburguer: ['preparacoes', 'sanduiches', 'alimentos'],
  suco: ['sumos', 'sucos', 'frutas'],
  energetico: ['bebidas', 'nao alcoolicas'],
};
function ncmWord(word: string): string {
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return word;
}
function ncmScore(description: string, targetTokens: Set<string>): number {
  const generic = new Set(['com', 'sem', 'para', 'dos', 'das', 'tipo', 'produto', 'un', 'ml', 'kg', 'litro', 'lata', 'garrafa', 'dose']);
  const query = normalizeText(description).split(' ').filter((w) => w.length >= 3 && !generic.has(w) && !/^\d+$/.test(w));
  if (!query.length) return 0;
  let evidence = 0;
  for (const word of query) {
    if (targetTokens.has(ncmWord(word))) { evidence += 1; continue; }
    if ((ALIASES[word] || []).some((synonym) => targetTokens.has(ncmWord(synonym)))) evidence += 0.45;
  }
  return Math.min(1, evidence / query.length);
}
function buildNcmIndex(ctx: SolCoreContext): NcmSearchIndex {
  const entries: NcmSearchIndex['entries'] = [];
  const inverted = new Map<string, Set<number>>();
  // A lista NCM sincronizada pode ser mais nova que o catálogo de regras.
  const activeCodes = new Set([...ctx.ncm.map((n) => normalizeDigits(n.codigo)), ...(ctx.fiscalCatalog ? officialNcmSet(ctx.fiscalCatalog) : [])]);
  for (const item of ctx.ncm) {
    if (!item.descricao || !activeCodes.has(normalizeDigits(item.codigo))) continue;
    const words = new Set(normalizeText(item.descricao).split(' ').filter((w) => w.length >= 3).map(ncmWord));
    const index = entries.length;
    entries.push({ item, words });
    for (const token of words) {
      let list = inverted.get(token);
      if (!list) { list = new Set(); inverted.set(token, list); }
      list.add(index);
    }
  }
  return { list: ctx.ncm, entries, inverted, results: new Map() };
}

function ncmCandidateSearch(ctx: SolCoreContext, description: string): Candidate[] {
  if (!description.trim()) return [];
  const key = normalizeText(description);
  let cache = ncmSearchCache.get(ctx);
  if (!cache || cache.list !== ctx.ncm) {
    cache = buildNcmIndex(ctx);
    ncmSearchCache.set(ctx, cache);
  }
  const previous = cache.results.get(key);
  if (previous) return previous;
  const queryWords = normalizeText(description).split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const choices = new Set<number>();
  for (const word of queryWords) {
    for (const alternative of [word, ...(ALIASES[word] || [])]) {
      for (const index of cache.inverted.get(ncmWord(alternative)) || []) choices.add(index);
    }
  }
  const matches = [...choices]
    .map((index) => ({ item: cache.entries[index].item, score: ncmScore(description, cache.entries[index].words) }))
    .filter(({ score }) => score >= 0.30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ item, score }) => ({
      code: normalizeDigits(item.codigo),
      label: item.descricao || '',
      score,
      confidence: score >= 0.78 ? 'média' as const : 'baixa' as const,
      reason: 'Correspondência por nome com a tabela NCM. É sugestão para revisão, NÃO enquadramento fiscal confirmado.',
    }));
  // Hipóteses ancoradas em exemplos de classificação da Receita, sempre
  // CONDICIONAIS. Exemplos parecidos podem ter NCM diferente pela composição.
  const hints: Candidate[] = [];
  const addHint = (code: string, label: string, reason: string) => {
    const valid = (ctx.fiscalCatalog && officialNcmSet(ctx.fiscalCatalog).has(code)) || ctx.ncm.some((row) => normalizeDigits(row.codigo) === code);
    if (!valid) return;
    hints.push({ code, label, score: 0.82, confidence: 'baixa', reason });
  };
  if (/\bempada\b/.test(key) && /\bfrango\b/.test(key)) {
    addHint('16023230', 'Preparações de carne de aves (empada de frango em caso específico)',
      'Solução de Consulta Cosit 98.209/2020 classificou empada pronta, assada, com 45% de frango neste NCM. Verifique peso do recheio, preparação e produto real.');
    addHint('19059090', 'Outros produtos de padaria/pastelaria (hipótese dependente da receita)',
      'Preparações de massa e recheio podem ter classificação diferente. A composição e as notas do capítulo 16/19 são indispensáveis.');
  } else if (/\bagua\b/.test(key) && /\bgas\b/.test(key) && !/\btonica\b/.test(key)) {
    addHint('22011000', 'Águas minerais e águas gaseificadas sem açúcar ou aromatização',
      'Candidato para água mineral/gaseificada sem açúcar, adoçante nem aromatizante. Confirme a rotulagem da mercadoria.');
  } else if (/\b(coca cola|fanta|sprite|kuat|refrigerante)\b/.test(key)) {
    addHint('22021000', 'Águas gaseificadas adoçadas ou aromatizadas',
      'Possível para refrigerante adoçado/aromatizado. Confirme a composição e rótulo.');
  } else if (/\b(amstel|brahma|heineken|kaiser|cerveja|baden|wals)\b/.test(key) && !/\bsem alcool\b/.test(key)) {
    addHint('22030000', 'Cervejas de malte',
      'Candidato para cerveja alcoólica de malte; confira se não é bebida sem álcool ou produto de outra categoria.');
  }
  const ordered = [...hints, ...matches.filter((candidate) => !hints.some((hint) => hint.code === candidate.code))].slice(0, 8);
  cache.results.set(key, ordered);
  return ordered;
}

function fuzzyProductCompatibility(product: string, target: string): number {
  const direct = textScore(product, target);
  const productTokens = normalizeText(product).split(/\s+/).filter((token) => token.length >= 4);
  const targetTokens = normalizeText(target).split(/\s+/).filter((token) => token.length >= 4);
  if (!productTokens.length || !targetTokens.length) return direct;
  let matches = 0;
  for (const token of productTokens) {
    if (targetTokens.some((candidate) => candidate === token || candidate.startsWith(token.slice(0, 4)) || token.startsWith(candidate.slice(0, 4)))) {
      matches += 1;
    }
  }
  const prefixCoverage = matches / productTokens.length;
  return Math.min(1, direct * 0.65 + prefixCoverage * 0.35);
}

function classDescription(ctx: SolCoreContext, cst: string, cClassTrib: string, fallback = ''): string {
  const found = ctx.classtrib.find((item) =>
    normalizeDigits(item.cst) === normalizeDigits(cst)
    && normalizeDigits(item.cClassTrib) === normalizeDigits(cClassTrib));
  return found?.descricao || fallback || `CST ${cst} / cClassTrib ${cClassTrib}`;
}

function catalogOptionCandidate(ctx: SolCoreContext, option: FiscalCatalogOption, index: number, productDescription = ''): Candidate {
  const cst = normalizeDigits(option.cst).slice(0, 3);
  const code = normalizeDigits(option.cc).slice(0, 6);
  const reduction = option.red ? ` • ${option.red}` : '';
  const annex = option.an ? ` • ${option.an}` : '';
  const label = classDescription(ctx, cst, code, option.base || option.r || 'Opção fiscal');
  const semanticText = [option.r, option.base, label].filter(Boolean).join(' ');
  const semanticScore = productDescription.trim() ? fuzzyProductCompatibility(productDescription, semanticText) : 0;
  const baseScore = Math.max(0.40, 0.68 - index * 0.015);
  const score = Math.min(1, baseScore * 0.45 + semanticScore * 0.55);
  const compatibility = semanticScore >= 0.62 ? 'alta' : semanticScore >= 0.34 ? 'média' : productDescription.trim() ? 'baixa' : 'não calculada';
  return {
    code,
    label,
    secondary: `CST ${cst}${annex}${reduction}`,
    score,
    confidence: !productDescription.trim() ? 'média' : semanticScore >= 0.62 ? 'alta' : semanticScore >= 0.34 ? 'média' : 'baixa',
    reason: option.base || 'O NCM possui mais de uma opção fiscal e exige decisão de contexto.',
    data: {
      cst,
      fundamento: option.base,
      anexo: option.an,
      reducao: option.red,
      rotulo: option.r,
      compatibilidade: compatibility,
    },
  };
}

function resolveByFiscalCatalog(
  ctx: SolCoreContext,
  catalog: FiscalCatalog,
  input: FiscalInput,
): FiscalResult {
  const ncm = normalizeDigits(input.ncm);
  const description = String(input.descricao || '').trim();
  const official = officialNcmSet(catalog);
  const ncmInCatalog = official.has(ncm);
  // A tabela de NCM e o catálogo de regras são conjuntos versionados DISTINTOS.
  // Um código da tabela NCM sincronizada não pode ser tratado como inexistente
  // só porque não está no catálogo fiscal antigo.
  const ncmFromReference = ctx.ncm.find((item) => normalizeDigits(item.codigo) === ncm);
  const ncmValid = ncm.length === 8 && ncm !== '00000000' && (ncmInCatalog || Boolean(ncmFromReference));
  const ncmCandidates = ncmValid ? [] : ncmCandidateSearch(ctx, description);

  const normalizedInput: FiscalInput = {
    ...input,
    ncm,
    // CEST é apenas consulta auxiliar e não participa do motor cClassTrib.
    cest: normalizeDigits(input.cest),
    cst: normalizeDigits(input.cst).slice(0, 3),
    cClassTrib: normalizeDigits(input.cClassTrib).slice(0, 6),
  };

  const baseResult = {
    engineVersion: 'Sol Core 0.8.0',
    input: normalizedInput,
    resolved: {
      ncm: ncmValid
        ? {
            codigo: ncm,
            codigoFormatado: formatNcm(ncm),
            descricao: ncmFromReference?.descricao,
            validated: true as const,
          }
        : null,
      cest: null,
      cClassTrib: null,
    },
    candidates: {
      ncm: ncmCandidates,
      cest: [],
      cClassTrib: [] as Candidate[],
    },
    warnings: [] as string[],
    sources: ctx.baseVersions,
  };

  if (!ncmValid) {
    const reason = !ncm || ncm === '00000000'
      ? ncmCandidates.length ? 'NCM não informado: candidatos localizados pela descrição. Confirme o NCM antes de calcular CST/cClassTrib.' : 'NCM não informado e sem candidato seguro por descrição. Detalhe o produto e confirme a classificação.'
      : 'NCM não encontrado na relação oficial da base local. Revise ou troque o NCM.';
    return {
      ...baseResult,
      status: 'revisão',
      confidence: 'indeterminada',
      decision: reason,
      warnings: [reason],
    };
  }

  const currentCstManual = normalizeDigits(normalizedInput.cst).slice(0, 3);
  const currentClassManual = normalizeDigits(normalizedInput.cClassTrib).slice(0, 6);
  // A escolha manual explícita sempre deve ser avaliada ANTES do padrão
  // automático 000/000001, sem apagar o trabalho do operador.
  if (input.manualConfirmed && isValidManualCombination(currentCstManual, currentClassManual)) {
    return {
      ...baseResult,
      status: 'validado',
      confidence: 'média',
      input: { ...normalizedInput, manualConfirmed: true },
      resolved: {
        ...baseResult.resolved,
        cClassTrib: {
          codigo: currentClassManual,
          cst: currentCstManual,
          descricao: classDescription(ctx, currentCstManual, currentClassManual, 'Classificação manual confirmada'),
          fundamento: 'Classificação confirmada pelo operador; confirmação de formato não equivale a homologação fiscal.',
          validated: true,
        },
      },
      decision: `Manual: NCM ${formatNcm(ncm)}, CST ${currentCstManual} e cClassTrib ${currentClassManual} registrados por decisão do operador.`,
      warnings: [ncmInCatalog
        ? 'Classificação manual: confirme o enquadramento fiscal, vigência e contexto.'
        : 'NCM consta na tabela NCM instalada, mas NÃO no catálogo fiscal de regras: classificação manual, conferir base atual e fundamento antes de aplicar.'],
    };
  }

  if (!ncmInCatalog) {
    const reason = 'NCM localizado na tabela NCM instalada, porém ausente do catálogo local de regras cClassTrib. Mantenha em revisão até confirmar CST/cClassTrib; não aplicar tributação integral por padrão.';
    return {
      ...baseResult,
      status: 'revisão',
      confidence: 'indeterminada',
      decision: reason,
      warnings: [reason],
    };
  }

  const special = catalog.special[ncm];
  const rawOptions = catalog.options[ncm] || [];

  // Mesma regra operacional do GL Reforma Fiscal: NCM oficial fora do índice
  // especial recebe o padrão operacional integral do catálogo, com alerta de contexto.
  if (!special) {
    return deterministicResult(
      ctx,
      baseResult,
      '000',
      '000001',
      'Tributação integral',
      'Padrão operacional do catálogo local para NCM sem tratamento especial identificado.',
      'Automático operacional: o NCM não possui tratamento especial identificado no catálogo local. CST 000 / cClassTrib 000001 aplicados como padrão do lote.',
      '',
      'média',
      ['O enquadramento 000/000001 é um padrão operacional do catálogo local para a operação usual; situações específicas da operação, destinatário ou benefício fiscal podem exigir outro cClassTrib.'],
    );
  }

  const situation = String(special.s || '').toUpperCase();
  const optionCount = Number(special.n || rawOptions.length || 0);
  let deterministicCst = normalizeDigits(special.cst).slice(0, 3);
  let deterministicClass = normalizeDigits(special.cc).slice(0, 6);
  let deterministicBase = special.base || '';
  let deterministicDfe = [special.an, special.red].filter(Boolean).join(' • ');

  // Alguns catálogos futuros podem representar uma regra única apenas em options.
  if ((!deterministicCst || !deterministicClass) && rawOptions.length === 1) {
    deterministicCst = normalizeDigits(rawOptions[0].cst).slice(0, 3);
    deterministicClass = normalizeDigits(rawOptions[0].cc).slice(0, 6);
    deterministicBase = rawOptions[0].base || deterministicBase;
    deterministicDfe = [rawOptions[0].an, rawOptions[0].red].filter(Boolean).join(' • ');
  }

  if (
    (situation === 'AMARELO' || optionCount === 1)
    && deterministicCst
    && deterministicClass
  ) {
    return deterministicResult(
      ctx,
      baseResult,
      deterministicCst,
      deterministicClass,
      deterministicBase || 'Classificação fiscal determinística',
      deterministicBase,
      `Automático: o NCM possui uma única classificação fiscal. CST ${deterministicCst} / cClassTrib ${deterministicClass}.`,
      deterministicDfe,
    );
  }

  const options = rawOptions
    .map((option, index) => catalogOptionCandidate(ctx, option, index, description))
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.code && candidate.data?.cst);

  const currentCst = normalizeDigits(normalizedInput.cst).slice(0, 3);
  const currentClass = normalizeDigits(normalizedInput.cClassTrib).slice(0, 6);

  // Se o arquivo já possui uma alternativa válida para o NCM, não obrigamos o
  // técnico a escolher de novo. O motor reconhece e mantém a combinação.
  if (currentClass) {
    const existing = rawOptions.find((option) => {
      const optionClass = normalizeDigits(option.cc).slice(0, 6);
      const optionCst = normalizeDigits(option.cst).slice(0, 3);
      return optionClass === currentClass && (!currentCst || currentCst === optionCst);
    });
    if (existing) {
      const existingCst = normalizeDigits(existing.cst).slice(0, 3);
      return confirmedOptionResult(
        ctx,
        baseResult,
        existingCst,
        currentClass,
        existing,
        'Já correto: a classificação existente é uma alternativa válida do catálogo para este NCM.',
      );
    }
  }

  if (input.manualConfirmed) {
    const chosenCst = currentCst;
    const chosenClass = currentClass;
    const chosen = rawOptions.find((option) =>
      normalizeDigits(option.cst).slice(0, 3) === chosenCst
      && normalizeDigits(option.cc).slice(0, 6) === chosenClass);

    if (chosen && chosenCst && chosenClass) {
      return confirmedOptionResult(
        ctx,
        baseResult,
        chosenCst,
        chosenClass,
        chosen,
        `Escolha confirmada pelo operador: CST ${chosenCst} / cClassTrib ${chosenClass}.`,
      );
    }

    // Igual ao fluxo manual do GL Reforma Fiscal: uma exceção pode ser
    // confirmada pelo operador mesmo fora das alternativas do catálogo, mas
    // somente com formato coerente e marcação explícita de decisão manual.
    if (isValidManualCombination(chosenCst, chosenClass)) {
      return {
        ...baseResult,
        status: 'validado',
        confidence: 'média',
        input: { ...normalizedInput, manualConfirmed: true },
        resolved: {
          ...baseResult.resolved,
          cClassTrib: {
            codigo: chosenClass,
            cst: chosenCst,
            descricao: classDescription(ctx, chosenCst, chosenClass, 'Classificação manual confirmada'),
            fundamento: 'Decisão manual informada pelo operador; combinação não veio das alternativas determinísticas do catálogo local.',
            validated: true,
          },
        },
        decision: `Manual: CST ${chosenCst} / cClassTrib ${chosenClass} confirmado pelo operador.`,
        warnings: ['Classificação manual fora das alternativas do catálogo. Revise a decisão fiscal antes de usar em produção.'],
      };
    }
  }

  return {
    ...baseResult,
    status: 'revisão',
    confidence: options.length ? 'média' : 'indeterminada',
    candidates: {
      ...baseResult.candidates,
      cClassTrib: options,
    },
    decision: options.length
      ? `Revisão: este NCM possui ${options.length} alternativas fiscais. Escolha a que corresponde ao produto.`
      : 'Revisão: a base local não encontrou uma classificação determinística para este NCM.',
    warnings: options.length
      ? ['Este NCM exige escolha de contexto; o motor não decide entre alternativas múltiplas sozinho.']
      : ['Sem classificação determinística na base local.'],
  };
}

function deterministicResult(
  ctx: SolCoreContext,
  baseResult: ReturnType<typeof makeBaseResultPlaceholder>,
  cst: string,
  cClassTrib: string,
  description: string,
  fundamento: string,
  decision: string,
  dfe = '',
  confidence: FiscalResult['confidence'] = 'alta',
  warnings: string[] = [],
): FiscalResult {
  return {
    ...baseResult,
    status: 'validado',
    confidence,
    resolved: {
      ...baseResult.resolved,
      cClassTrib: {
        codigo: cClassTrib,
        cst,
        descricao: classDescription(ctx, cst, cClassTrib, description),
        fundamento,
        dfe,
        validated: true,
      },
    },
    decision,
    warnings,
  };
}

// Função só para fornecer um tipo estrutural reutilizável sem duplicar uma
// interface privada do resultado-base.
function makeBaseResultPlaceholder() {
  return {
    engineVersion: '',
    input: {} as FiscalInput,
    resolved: {
      ncm: null as FiscalResult['resolved']['ncm'],
      cest: null as FiscalResult['resolved']['cest'],
      cClassTrib: null as FiscalResult['resolved']['cClassTrib'],
    },
    candidates: { ncm: [] as Candidate[], cest: [] as Candidate[], cClassTrib: [] as Candidate[] },
    warnings: [] as string[],
    sources: undefined as Record<string, string> | undefined,
  };
}

function confirmedOptionResult(
  ctx: SolCoreContext,
  baseResult: ReturnType<typeof makeBaseResultPlaceholder>,
  cst: string,
  cClassTrib: string,
  option: FiscalCatalogOption,
  decision: string,
): FiscalResult {
  return {
    ...baseResult,
    status: 'validado',
    confidence: 'alta',
    resolved: {
      ...baseResult.resolved,
      cClassTrib: {
        codigo: cClassTrib,
        cst,
        descricao: classDescription(ctx, cst, cClassTrib, option.base || option.r || 'Alternativa fiscal confirmada'),
        fundamento: option.base,
        dfe: [option.an, option.red].filter(Boolean).join(' • '),
        validated: true,
      },
    },
    decision,
  };
}

function isValidManualCombination(cst: string, cClassTrib: string): boolean {
  return cst.length === 3
    && cClassTrib.length === 6
    && cClassTrib.slice(0, 3) === cst;
}

/**
 * Motor fiscal principal.
 *
 * O Catálogo Fiscal local replica o fluxo operacional validado no GL Reforma
 * Fiscal: determinístico entra pronto; NCM inválido ou NCM contextual vai para
 * revisão; alternativas já existentes no arquivo são reconhecidas; decisão
 * manual explícita continua disponível para exceções.
 */
export function classifyProduct(ctx: SolCoreContext, input: FiscalInput): FiscalResult {
  if (ctx.fiscalCatalog) {
    return resolveByFiscalCatalog(ctx, ctx.fiscalCatalog, input);
  }
  return classifyFallback(ctx, input);
}

function classifyFallback(ctx: SolCoreContext, input: FiscalInput): FiscalResult {
  const ncm = normalizeDigits(input.ncm);
  const exactNcm = ctx.ncm.find((item) => normalizeDigits(item.codigo) === ncm);
  const classCode = normalizeDigits(input.cClassTrib).slice(0, 6);
  const cst = normalizeDigits(input.cst).slice(0, 3);
  const exactClass = ctx.classtrib.find((item) =>
    normalizeDigits(item.cClassTrib) === classCode
    && (!cst || normalizeDigits(item.cst) === cst));

  const ncmCandidates = exactNcm ? [] : ncmCandidateSearch(ctx, String(input.descricao || ''));
  const classCandidates: Candidate[] = cst
    ? ctx.classtrib
        .filter((item) => normalizeDigits(item.cst) === cst)
        .slice(0, 20)
        .map((item) => ({
          code: item.cClassTrib,
          label: item.descricao,
          secondary: `CST ${item.cst}`,
          score: 0.5,
          confidence: 'baixa',
          reason: 'Fallback sem catálogo fiscal determinístico.',
          data: { cst: item.cst, fundamento: item.fundamento },
        }))
    : [];

  const valid = Boolean(exactNcm && exactClass);
  return {
    engineVersion: 'Sol Core 0.8.0-fallback',
    status: valid ? 'validado' : 'revisão',
    confidence: valid ? 'alta' : 'indeterminada',
    input: { ...input, ncm, cst, cClassTrib: classCode },
    resolved: {
      ncm: exactNcm ? { codigo: ncm, codigoFormatado: formatNcm(ncm), descricao: exactNcm.descricao, validated: true } : null,
      cest: null,
      cClassTrib: exactClass ? {
        codigo: exactClass.cClassTrib,
        cst: exactClass.cst,
        descricao: exactClass.descricao,
        fundamento: exactClass.fundamento,
        dfe: exactClass.dfe,
        validated: true,
      } : null,
    },
    candidates: { ncm: ncmCandidates, cest: [], cClassTrib: classCandidates },
    warnings: valid ? [] : ['Catálogo fiscal determinístico indisponível; item mantido em revisão.'],
    decision: valid ? 'Valores confirmados na base local.' : 'Requer revisão.',
    sources: ctx.baseVersions,
  };
}

export function searchClassTrib(items: ClassTribItem[], term: string): ClassTribItem[] {
  const textQuery = normalizeText(term);
  const digitQuery = normalizeDigits(term);

  if (!textQuery && !digitQuery) return items.slice(0, 100);

  return items
    .filter((item) =>
      normalizeDigits(item.cClassTrib).includes(digitQuery)
      || normalizeDigits(item.cst).includes(digitQuery)
      || normalizeText(`${item.descricao} ${item.fundamento || ''}`).includes(textQuery))
    .slice(0, 250);
}
