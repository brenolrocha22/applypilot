import type {
  DimensionResult,
  DimensionWeights,
  FitReport,
  FitSummaryCounts,
  RelevantExperience,
  RequirementAssessment,
} from '../model/fit';
import type { Dimension, JobInput, ParsedJob } from '../model/job';
import type { Profile } from '../model/profile';
import { parseJob } from '../job/parser';
import { skillDisplayName } from '../knowledge/skills';
import { assessRequirement, type AssessContext } from './assessors';
import { buildProfileIndex, type ProfileIndex } from './profileIndex';
import { buildRecommendation } from './recommendation';
import { DEFAULT_DIMENSION_WEIGHTS, DIMENSIONS, IMPORTANCE_WEIGHTS, KIND_WEIGHT_FACTOR, normalizeWeights, validateWeights } from './weights';

export const ENGINE_VERSION = '0.1.0';

export interface FitOptions {
  weights?: DimensionWeights;
  /** Data de referência para "emprego atual" (determinismo em testes). */
  referenceDate?: Date;
  /** Timestamp gravado no relatório. */
  now?: string;
}

/** Motivo para uma dimensão não ser avaliável por falta de dados no perfil. */
function missingProfileData(dim: Dimension, profile: Profile): string | null {
  switch (dim) {
    case 'technical':
      return profile.skills.length || profile.experiences.length ? null : 'Perfil sem competências ou experiências cadastradas.';
    case 'experience':
      return profile.experiences.length ? null : 'Perfil sem experiências profissionais cadastradas.';
    case 'education':
      return profile.education.length || profile.certifications.length || profile.courses.length
        ? null
        : 'Perfil sem formação, cursos ou certificações cadastrados.';
    case 'language':
      return profile.languages.length ? null : 'Perfil sem idiomas declarados.';
    case 'culture':
      return null; // tratado pela regra específica (preferências não declaradas ⇒ não aplicável)
  }
}

const NO_JOB_DATA: Record<Dimension, string> = {
  technical: 'A vaga não tem competências técnicas identificáveis.',
  experience: 'A vaga não tem requisitos de experiência identificáveis.',
  education: 'A vaga não tem requisitos de formação, cursos ou certificações identificáveis.',
  language: 'A vaga não menciona idiomas.',
  culture: 'Dados insuficientes para avaliar o fit cultural.',
};

function scoreAssessments(list: RequirementAssessment[]): number | null {
  let num = 0;
  let den = 0;
  for (const a of list) {
    if (a.status === 'not_applicable') continue;
    const w = IMPORTANCE_WEIGHTS[a.requirement.importance] * (KIND_WEIGHT_FACTOR[a.requirement.kind] ?? 1);
    num += w * a.credit * a.confidence;
    den += w;
  }
  return den > 0 ? Math.round((num / den) * 100) : null;
}

function evaluateDimension(dim: Dimension, assessments: RequirementAssessment[], weight: number, profile: Profile): DimensionResult {
  const base = { dimension: dim, weight, assessments };
  if (!assessments.length) return { ...base, evaluable: false, score: null, note: NO_JOB_DATA[dim] };
  const missing = missingProfileData(dim, profile);
  if (missing) return { ...base, evaluable: false, score: null, note: `${missing} A dimensão não foi pontuada (não conta como zero).` };
  const score = scoreAssessments(assessments);
  if (score === null) {
    const note =
      dim === 'culture'
        ? 'A vaga descreve características do ambiente, mas você não declarou preferências correspondentes. Dados insuficientes para avaliar o fit cultural.'
        : 'Nenhum requisito aplicável para esta dimensão.';
    return { ...base, evaluable: false, score: null, note };
  }
  return { ...base, evaluable: true, score, note: null };
}

function computeCounts(all: RequirementAssessment[]): FitSummaryCounts {
  const applicable = all.filter((a) => a.status !== 'not_applicable');
  const required = applicable.filter((a) => a.requirement.importance === 'required');
  const preferred = applicable.filter((a) => a.requirement.importance === 'preferred');
  const requiredMet = required.filter((a) => a.status === 'met').length;
  return {
    requiredTotal: required.length,
    requiredMet,
    requiredMetPct: required.length ? Math.round((requiredMet / required.length) * 100) : null,
    preferredTotal: preferred.length,
    preferredMet: preferred.filter((a) => a.status === 'met').length,
    notProven: applicable.filter((a) => a.status === 'not_proven').length,
    notMet: applicable.filter((a) => a.status === 'not_met').length,
    partiallyMet: applicable.filter((a) => a.status === 'partially_met').length,
  };
}

function relevantExperiences(index: ProfileIndex, all: RequirementAssessment[]): RelevantExperience[] {
  const out: RelevantExperience[] = [];
  for (const exp of index.profile.experiences) {
    const terms = new Set<string>();
    const resp: RelevantExperience['responsibilityMatches'] = [];
    for (const a of all) {
      if (a.status !== 'met' && a.status !== 'partially_met') continue;
      if (!a.evidence.some((e) => e.profilePath === `experiences/${exp.id}`)) continue;
      if (a.requirement.kind === 'skill') terms.add(a.requirement.skillName ?? skillDisplayName(a.requirement.skillId ?? ''));
      if (a.requirement.kind === 'responsibility') resp.push(a.requirement.source);
    }
    if (terms.size || resp.length) {
      out.push({ experienceId: exp.id, title: exp.title, company: exp.company, matchedTerms: Array.from(terms), responsibilityMatches: resp });
    }
  }
  return out.sort((a, b) => b.matchedTerms.length + b.responsibilityMatches.length - (a.matchedTerms.length + a.responsibilityMatches.length));
}

/**
 * Calcula a compatibilidade entre um perfil e uma vaga já interpretada.
 * Função pura e determinística: mesmas entradas (incluindo referenceDate/now) ⇒ mesmo relatório.
 */
export function computeFit(profile: Profile, parsed: ParsedJob, options: FitOptions = {}): FitReport {
  const rawWeights = options.weights ?? DEFAULT_DIMENSION_WEIGHTS;
  const weights = validateWeights(rawWeights).length ? DEFAULT_DIMENSION_WEIGHTS : normalizeWeights(rawWeights);
  const referenceDate = options.referenceDate ?? new Date();
  const index = buildProfileIndex(profile);
  const ctx: AssessContext = { index, referenceDate, jobWorkModes: parsed.workModes };

  const all = parsed.requirements.map((r) => assessRequirement(r, ctx));
  const dimensions = DIMENSIONS.map((dim) =>
    evaluateDimension(
      dim,
      all.filter((a) => a.requirement.dimension === dim),
      weights[dim],
      profile,
    ),
  );

  const evaluable = dimensions.filter((d) => d.evaluable && d.score !== null);
  const coverage = evaluable.reduce((s, d) => s + d.weight, 0);
  const overallScore = coverage > 0 ? Math.round(evaluable.reduce((s, d) => s + d.weight * (d.score ?? 0), 0) / coverage) : null;

  const blockers = all
    .filter((a) => (a.requirement.eliminatory || a.requirement.importance === 'required') && a.status !== 'met' && a.status !== 'not_applicable')
    .sort((a, b) => Number(b.requirement.eliminatory) - Number(a.requirement.eliminatory) || Number(b.status === 'not_met') - Number(a.status === 'not_met'));

  const counts = computeCounts(all);
  const limitations = [
    'A pontuação indica compatibilidade com os requisitos identificados; não é probabilidade de contratação.',
    'Requisitos são extraídos por regras e podem estar incompletos ou mal classificados; confira os trechos originais.',
    ...parsed.warnings,
    ...dimensions.filter((d) => !d.evaluable && d.note).map((d) => `${d.dimension}: ${d.note}`),
  ];

  const partial: Omit<FitReport, 'recommendation'> = {
    engineVersion: ENGINE_VERSION,
    generatedAt: options.now ?? new Date().toISOString(),
    referenceDate: referenceDate.toISOString(),
    weights,
    overallScore,
    coverage: Math.round(coverage * 100) / 100,
    dimensions,
    counts,
    blockers,
    relevantExperiences: relevantExperiences(index, all),
    needsConfirmation: all.filter((a) => a.needsConfirmation),
    limitations,
  };
  return { ...partial, recommendation: buildRecommendation(partial) };
}

/** Atalho: interpreta a vaga usando o vocabulário do perfil e calcula o fit. */
export function analyzeJob(profile: Profile, input: JobInput, options: FitOptions = {}): { parsed: ParsedJob; report: FitReport } {
  const index = buildProfileIndex(profile);
  const parsed = parseJob(input, { extraVocabulary: index.customVocabulary });
  return { parsed, report: computeFit(profile, parsed, options) };
}
