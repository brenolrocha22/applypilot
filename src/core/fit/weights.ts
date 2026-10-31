import type { DimensionWeights, ImportanceWeights, RequirementStatus } from '../model/fit';
import type { Dimension, RequirementKind } from '../model/job';

/** Pesos provisórios do protótipo (ver docs/FIT_SCORING.md). Devem ser validados com uso real. */
export const DEFAULT_DIMENSION_WEIGHTS: DimensionWeights = {
  technical: 0.35,
  experience: 0.3,
  education: 0.15,
  language: 0.1,
  culture: 0.1,
};

/** Peso de cada requisito dentro da sua dimensão, conforme a importância declarada na vaga. */
export const IMPORTANCE_WEIGHTS: ImportanceWeights = {
  required: 2,
  unspecified: 1.5,
  preferred: 1,
};

/**
 * Fator adicional por tipo de requisito. Responsabilidades e linhas não estruturadas são avaliadas
 * só por semelhança textual, então pesam menos que requisitos estruturados.
 */
export const KIND_WEIGHT_FACTOR: Partial<Record<RequirementKind, number>> = {
  responsibility: 0.5,
  other: 0.75,
};

/** Crédito base por estado (antes do multiplicador de confiança da evidência). */
export const STATUS_CREDIT: Record<RequirementStatus, number> = {
  met: 1,
  partially_met: 0.5,
  not_proven: 0,
  not_met: 0,
  not_applicable: 0,
};

export const DIMENSIONS: Dimension[] = ['technical', 'experience', 'education', 'language', 'culture'];

/** Valida pesos configurados pelo usuário. Retorna mensagens de erro (vazio = válido). */
export function validateWeights(w: DimensionWeights): string[] {
  const errors: string[] = [];
  for (const d of DIMENSIONS) {
    const v = w[d];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errors.push(`Peso inválido para ${d}.`);
  }
  const total = DIMENSIONS.reduce((s, d) => s + (Number.isFinite(w[d]) ? w[d] : 0), 0);
  if (total <= 0) errors.push('A soma dos pesos deve ser maior que zero.');
  return errors;
}

/** Normaliza para soma 1 (permite que o usuário informe percentuais ou valores arbitrários). */
export function normalizeWeights(w: DimensionWeights): DimensionWeights {
  const total = DIMENSIONS.reduce((s, d) => s + w[d], 0);
  if (total <= 0) return { ...DEFAULT_DIMENSION_WEIGHTS };
  return Object.fromEntries(DIMENSIONS.map((d) => [d, w[d] / total])) as DimensionWeights;
}
