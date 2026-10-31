import type { Dimension, Importance, JobRequirement, SourceSpan } from './job';
import type { ValidationStatus } from './provenance';

export type RequirementStatus = 'met' | 'partially_met' | 'not_proven' | 'not_met' | 'not_applicable';

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  met: 'Atendido',
  partially_met: 'Parcialmente atendido',
  not_proven: 'Não comprovado',
  not_met: 'Não atendido',
  not_applicable: 'Não aplicável',
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  technical: 'Fit técnico',
  experience: 'Fit de experiência',
  education: 'Fit de formação',
  language: 'Fit de idiomas',
  culture: 'Fit cultural',
};

export type DimensionWeights = Record<Dimension, number>;

/** Evidência encontrada no perfil que sustenta (ou contradiz) um requisito. */
export interface Evidence {
  /** Caminho do item no perfil, ex.: "skills/abc123" ou "experiences/xyz". */
  profilePath: string;
  /** Descrição legível da evidência. */
  description: string;
  /** Trecho exato do perfil, quando aplicável. */
  snippet?: string;
  validationStatus: ValidationStatus;
}

export interface RequirementAssessment {
  requirement: JobRequirement;
  status: RequirementStatus;
  /** Crédito de 0 a 1 antes do ajuste de confiança. */
  credit: number;
  /** Multiplicador pela confiança da evidência (estado de validação). */
  confidence: number;
  evidence: Evidence[];
  justification: string;
  /** Incerteza ou ressalva da conclusão. */
  uncertainty: string | null;
  /** Evidência existe mas não está confirmada pelo usuário. */
  needsConfirmation: boolean;
}

export interface DimensionResult {
  dimension: Dimension;
  evaluable: boolean;
  /** 0–100, null quando não avaliável. */
  score: number | null;
  weight: number;
  assessments: RequirementAssessment[];
  /** Motivo quando não avaliável, ou observação geral. */
  note: string | null;
}

export interface RelevantExperience {
  experienceId: string;
  title: string;
  company: string;
  matchedTerms: string[];
  responsibilityMatches: SourceSpan[];
}

export interface FitSummaryCounts {
  requiredTotal: number;
  requiredMet: number;
  /** Percentual (0–100) de obrigatórios comprovadamente atendidos; null se não há obrigatórios identificados. */
  requiredMetPct: number | null;
  preferredTotal: number;
  preferredMet: number;
  notProven: number;
  notMet: number;
  partiallyMet: number;
}

export interface FitReport {
  engineVersion: string;
  generatedAt: string;
  referenceDate: string;
  weights: DimensionWeights;
  /** 0–100, null se nenhuma dimensão for avaliável. */
  overallScore: number | null;
  /** Soma dos pesos das dimensões avaliáveis (0–1). */
  coverage: number;
  dimensions: DimensionResult[];
  counts: FitSummaryCounts;
  /** Requisitos eliminatórios ou obrigatórios não comprovadamente atendidos (independentes da nota). */
  blockers: RequirementAssessment[];
  relevantExperiences: RelevantExperience[];
  needsConfirmation: RequirementAssessment[];
  recommendation: Recommendation;
  limitations: string[];
}

export type RecommendationLevel = 'strong' | 'moderate' | 'weak' | 'review_blockers' | 'insufficient_data';

export interface Recommendation {
  level: RecommendationLevel;
  headline: string;
  explanation: string[];
  nextActions: string[];
}

export type ImportanceWeights = Record<Importance, number>;
