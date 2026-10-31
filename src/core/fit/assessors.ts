import type { Evidence, RequirementAssessment, RequirementStatus } from '../model/fit';
import type { JobRequirement } from '../model/job';
import { EVIDENCE_CONFIDENCE, type ValidationStatus } from '../model/provenance';
import { EDUCATION_LEVEL_LABELS, educationRank } from '../knowledge/education';
import { LANGUAGE_LEVEL_LABELS, languageLevelRank, languageName, resolveLanguageId } from '../knowledge/languages';
import { meaningfulTokens, normalizeText, uniq } from '../knowledge/normalize';
import { skillDisplayName } from '../knowledge/skills';
import { totalYears } from '../profile/dates';
import { implyingSkills, relatedSkills, type ProfileIndex } from './profileIndex';
import { STATUS_CREDIT } from './weights';

/**
 * Avaliadores por tipo de requisito. Regras gerais:
 * - Ausência de informação ⇒ "Não comprovado" (nunca "Não atendido").
 * - "Não atendido" só quando o próprio perfil traz evidência contrária (ex.: nível de idioma declarado inferior).
 * - Competência semelhante ⇒ no máximo "Parcialmente atendido", com justificativa.
 */

export interface AssessContext {
  index: ProfileIndex;
  referenceDate: Date;
  /** Modalidades oferecidas pela vaga (para avaliar alternativas em conjunto). */
  jobWorkModes: string[];
}

const SIMILARITY_UNCERTAINTY = 'Correspondência estimada por semelhança textual; revise a evidência.';

function result(
  requirement: JobRequirement,
  status: RequirementStatus,
  justification: string,
  evidence: Evidence[] = [],
  opts: { credit?: number; uncertainty?: string | null } = {},
): RequirementAssessment {
  const counted = status === 'met' || status === 'partially_met';
  const confidence = counted && evidence.length ? Math.max(...evidence.map((e) => EVIDENCE_CONFIDENCE[e.validationStatus])) : 1;
  const needsConfirmation = counted && evidence.length > 0 && !evidence.some((e) => e.validationStatus === 'confirmed');
  let uncertainty = opts.uncertainty ?? null;
  if (needsConfirmation) {
    const note = 'A evidência ainda não foi confirmada por você.';
    uncertainty = uncertainty ? `${uncertainty} ${note}` : note;
  }
  return {
    requirement,
    status,
    credit: opts.credit ?? STATUS_CREDIT[status],
    confidence,
    evidence,
    justification,
    uncertainty,
    needsConfirmation,
  };
}

/** Evidências com estado "sugerido pela IA" não contam; mantêm-se como itens a confirmar. */
function usable(evidence: Evidence[]): Evidence[] {
  return evidence.filter((e) => EVIDENCE_CONFIDENCE[e.validationStatus] > 0);
}

function allConfirmed(items: { provenance: { status: ValidationStatus } }[]): boolean {
  return items.length > 0 && items.every((i) => i.provenance.status === 'confirmed');
}

export function assessSkill(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const id = req.skillId!;
  const name = req.skillName ?? skillDisplayName(id);
  const direct = usable(ctx.index.skillEvidence.get(id) ?? []);
  if (direct.length) {
    const onlyMentions = direct.every((e) => e.profilePath === 'summary' || e.snippet !== undefined);
    return result(req, 'met', `${name} aparece no seu perfil.`, direct, {
      uncertainty: onlyMentions ? 'Competência citada em texto, não declarada como competência.' : null,
    });
  }
  const implying = implyingSkills(ctx.index, id);
  if (implying.length) {
    const ev = implying.flatMap((s) => usable(ctx.index.skillEvidence.get(s) ?? []));
    if (ev.length) {
      const names = implying.map((s) => skillDisplayName(s)).join(', ');
      return result(req, 'met', `${names} pressupõe conhecimento de ${name}.`, ev, {
        uncertainty: `Inferido a partir de ${names}; não há menção direta a ${name}.`,
      });
    }
  }
  const related = relatedSkills(ctx.index, id);
  if (related.length) {
    const ev = related.flatMap((s) => usable(ctx.index.skillEvidence.get(s) ?? []));
    if (ev.length) {
      const names = related.map((s) => skillDisplayName(s)).join(', ');
      return result(req, 'partially_met', `Você possui ${names}, competência semelhante a ${name}, mas não equivalente.`, ev, {
        uncertainty: 'Competências semelhantes não são consideradas equivalentes.',
      });
    }
  }
  const aiOnly = (ctx.index.skillEvidence.get(id) ?? []).filter((e) => e.validationStatus === 'ai_suggested');
  if (aiOnly.length) {
    return { ...result(req, 'not_proven', `${name} foi apenas sugerido e não conta como evidência.`, aiOnly), needsConfirmation: true };
  }
  return result(req, 'not_proven', `${name} não foi encontrado no seu perfil.`, [], {
    uncertainty: 'A ausência no perfil não significa que você não possui a competência.',
  });
}

function yearsStatus(
  req: JobRequirement,
  years: number,
  min: number,
  evidence: Evidence[],
  contradictionAllowed: boolean,
  subject: string,
  uncertainty: string | null = null,
): RequirementAssessment {
  const yrs = years.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (years >= min) return result(req, 'met', `${yrs} ano(s) de ${subject} (mínimo: ${min}).`, evidence, { uncertainty });
  if (years >= min * 0.75) {
    return result(req, 'partially_met', `${yrs} ano(s) de ${subject}, próximo do mínimo de ${min}.`, evidence, {
      credit: years / min,
      uncertainty,
    });
  }
  if (contradictionAllowed) {
    return result(req, 'not_met', `${yrs} ano(s) de ${subject} no perfil confirmado; a vaga pede ${min}.`, evidence, { uncertainty });
  }
  return result(req, 'not_proven', `${yrs} ano(s) de ${subject} identificados no perfil; a vaga pede ${min}.`, evidence, {
    uncertainty: uncertainty ?? 'O perfil pode estar incompleto (experiências sem data ou não confirmadas).',
  });
}

export function assessYears(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const { profile } = ctx.index;
  const min = req.minYears ?? 0;
  const scope = req.scopeSkillIds ?? [];
  if (!profile.experiences.length) {
    return result(req, 'not_proven', 'Nenhuma experiência profissional cadastrada.', [], {
      uncertainty: 'Cadastre suas experiências para avaliar este requisito.',
    });
  }

  if (!scope.length || req.kind === 'seniority') {
    const comp = totalYears(profile.experiences, ctx.referenceDate);
    const counted = profile.experiences.filter((e) => comp.countedExperienceIds.includes(e.id));
    const evidence: Evidence[] = counted.map((e) => ({
      profilePath: `experiences/${e.id}`,
      description: `${e.title}${e.company ? ` — ${e.company}` : ''} (${e.startDate ?? '?'} a ${e.current ? 'atual' : e.endDate ?? '?'})`,
      validationStatus: e.provenance.status,
    }));
    const canContradict = req.kind !== 'seniority' && comp.undatedExperienceIds.length === 0 && allConfirmed(profile.experiences);
    const uncertainty =
      req.kind === 'seniority'
        ? 'Senioridade convertida em anos de forma aproximada; empresas definem senioridade de formas diferentes.'
        : comp.undatedExperienceIds.length
          ? `${comp.undatedExperienceIds.length} experiência(s) sem datas completas não foram contabilizadas.`
          : null;
    return yearsStatus(req, comp.years, min, evidence, canContradict, 'experiência profissional', uncertainty);
  }

  // Anos com competências específicas: experiências que usam a competência (ou que a implicam).
  const expIds = new Set<string>();
  const declaredYears: number[] = [];
  for (const skillId of scope) {
    for (const s of [skillId, ...implyingSkills(ctx.index, skillId)]) {
      for (const id of ctx.index.skillExperiences.get(s) ?? []) expIds.add(id);
    }
    for (const s of profile.skills) {
      if (s.yearsOfExperience !== undefined && ctx.index.skillEvidence.get(skillId)?.some((e) => e.profilePath === `skills/${s.id}`)) {
        declaredYears.push(s.yearsOfExperience);
      }
    }
  }
  const exps = profile.experiences.filter((e) => expIds.has(e.id));
  const comp = totalYears(exps, ctx.referenceDate);
  const years = Math.max(comp.years, ...declaredYears, 0);
  const evidence: Evidence[] = exps.map((e) => ({
    profilePath: `experiences/${e.id}`,
    description: `${e.title}${e.company ? ` — ${e.company}` : ''}`,
    validationStatus: e.provenance.status,
  }));
  const subject = `experiência com ${scope.map((s) => skillDisplayName(s)).join(', ')}`;
  if (!exps.length && !declaredYears.length) {
    return result(req, 'not_proven', `Nenhuma experiência registrada com ${scope.map((s) => skillDisplayName(s)).join(', ')}.`, [], {
      uncertainty: 'Indique nas experiências as competências utilizadas.',
    });
  }
  return yearsStatus(req, years, min, evidence, false, subject);
}

/** Proporção de tokens do requisito encontrados num conjunto de tokens do perfil. */
function overlap(text: string, tokens: Set<string>): { ratio: number; matched: string[] } {
  const reqTokens = uniq(meaningfulTokens(text));
  if (!reqTokens.length) return { ratio: 0, matched: [] };
  const matched = reqTokens.filter((t) => tokens.has(t));
  return { ratio: matched.length / reqTokens.length, matched };
}

export function assessResponsibility(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  let best: { expId: string; ratio: number; matched: string[] } | null = null;
  for (const [expId, tokens] of ctx.index.experienceTokens) {
    const o = overlap(req.label, tokens);
    if (!best || o.ratio > best.ratio) best = { expId, ...o };
  }
  if (!best || best.matched.length < 2 || best.ratio < 0.3) {
    return result(req, 'not_proven', 'Nenhuma experiência com atividades semelhantes foi encontrada.', [], { uncertainty: SIMILARITY_UNCERTAINTY });
  }
  const exp = ctx.index.profile.experiences.find((e) => e.id === best!.expId)!;
  const ev: Evidence = {
    profilePath: `experiences/${exp.id}`,
    description: `${exp.title}${exp.company ? ` — ${exp.company}` : ''}`,
    snippet: `Termos em comum: ${best.matched.join(', ')}`,
    validationStatus: exp.provenance.status,
  };
  const status: RequirementStatus = best.ratio >= 0.6 && best.matched.length >= 3 ? 'met' : 'partially_met';
  return result(req, status, `Atividade semelhante na experiência "${exp.title}".`, [ev], { uncertainty: SIMILARITY_UNCERTAINTY });
}

export function assessOther(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const o = overlap(req.label, ctx.index.allTokens);
  if (o.matched.length >= 2 && o.ratio >= 0.5) {
    return result(
      req,
      'partially_met',
      'Há termos do requisito no seu perfil, mas ele não pôde ser verificado de forma estruturada.',
      [{ profilePath: 'profile', description: 'Termos encontrados no perfil', snippet: o.matched.join(', '), validationStatus: 'confirmed' }],
      { uncertainty: SIMILARITY_UNCERTAINTY },
    );
  }
  return result(req, 'not_proven', 'Requisito não estruturado; não foi possível comprová-lo automaticamente.', [], {
    uncertainty: 'Revise este requisito manualmente.',
  });
}

export function assessEducation(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const required = req.educationLevel!;
  const edu = ctx.index.profile.education;
  if (!edu.length) {
    return result(req, 'not_proven', 'Nenhuma formação acadêmica cadastrada.', [], { uncertainty: 'Cadastre sua formação para avaliar este requisito.' });
  }
  const ev = (e: (typeof edu)[number]): Evidence => ({
    profilePath: `education/${e.id}`,
    description: `${EDUCATION_LEVEL_LABELS[e.level]}${e.degree ? `: ${e.degree}` : ''}${e.institution ? ` — ${e.institution}` : ''} (${e.status === 'completed' ? 'concluído' : e.status === 'in_progress' ? 'em andamento' : 'incompleto'})`,
    validationStatus: e.provenance.status,
  });
  const fieldNote = /\b(em|in)\b/.test(normalizeText(req.source.text)) ? 'A área de formação exigida não é verificada automaticamente.' : null;
  const completed = edu.filter((e) => e.status === 'completed' && educationRank(e.level) >= educationRank(required));
  if (completed.length) {
    const tecNote = completed.every((e) => e.level === 'associate') && required === 'bachelor' ? 'Tecnólogo é graduação, mas algumas vagas exigem bacharelado.' : null;
    return result(req, 'met', `Formação compatível com ${EDUCATION_LEVEL_LABELS[required]}.`, completed.map(ev), {
      uncertainty: [fieldNote, tecNote].filter(Boolean).join(' ') || null,
    });
  }
  const inProgress = edu.filter((e) => e.status === 'in_progress' && educationRank(e.level) >= educationRank(required));
  if (inProgress.length) {
    return result(req, 'partially_met', `Formação em andamento no nível exigido (${EDUCATION_LEVEL_LABELS[required]}).`, inProgress.map(ev), { uncertainty: fieldNote });
  }
  if (allConfirmed(edu)) {
    return result(req, 'not_met', `Sua formação confirmada está abaixo de ${EDUCATION_LEVEL_LABELS[required]}.`, edu.map(ev), { uncertainty: fieldNote });
  }
  return result(req, 'not_proven', `Nenhuma formação de nível ${EDUCATION_LEVEL_LABELS[required]} encontrada.`, edu.map(ev), {
    uncertainty: 'Há formações não confirmadas; revise o perfil.',
  });
}

export function assessCertification(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const wanted = new Set(meaningfulTokens(req.certificationName ?? ''));
  const wantedNorm = normalizeText(req.certificationName ?? '');
  const matches = (name: string) => {
    const n = normalizeText(name);
    if (!n) return false;
    if (n.includes(wantedNorm) || wantedNorm.includes(n)) return true;
    const t = meaningfulTokens(name);
    const hit = t.filter((x) => wanted.has(x)).length;
    return wanted.size > 0 && hit / wanted.size >= 0.6;
  };
  const certs = ctx.index.profile.certifications.filter((c) => matches(c.name));
  if (certs.length) {
    return result(
      req,
      'met',
      'Certificação correspondente encontrada.',
      certs.map((c) => ({ profilePath: `certifications/${c.id}`, description: `${c.name}${c.issuer ? ` — ${c.issuer}` : ''}`, validationStatus: c.provenance.status })),
      { uncertainty: 'Confirme se a certificação é exatamente a solicitada e se está válida.' },
    );
  }
  const courses = ctx.index.profile.courses.filter((c) => matches(c.name));
  if (courses.length) {
    return result(
      req,
      'partially_met',
      'Há curso relacionado, mas curso não equivale a certificação.',
      courses.map((c) => ({ profilePath: `courses/${c.id}`, description: c.name, validationStatus: c.provenance.status })),
    );
  }
  return result(req, 'not_proven', 'Certificação não encontrada no perfil.');
}

export function assessLanguage(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const langs = ctx.index.profile.languages.filter((l) => resolveLanguageId(l.name) === req.language);
  const name = languageName(req.language ?? '');
  if (!langs.length) {
    return result(req, 'not_proven', `${name} não está declarado no seu perfil.`, [], { uncertainty: 'Declare seus idiomas e níveis no perfil.' });
  }
  const best = langs.reduce((a, b) => (languageLevelRank(b.level) > languageLevelRank(a.level) ? b : a));
  const ev: Evidence[] = [{ profilePath: `languages/${best.id}`, description: `${best.name}: ${LANGUAGE_LEVEL_LABELS[best.level]}`, validationStatus: best.provenance.status }];
  if (!req.languageLevel) return result(req, 'met', `${name} declarado (a vaga não especifica nível).`, ev);
  const diff = languageLevelRank(best.level) - languageLevelRank(req.languageLevel);
  const wanted = LANGUAGE_LEVEL_LABELS[req.languageLevel];
  if (diff >= 0) return result(req, 'met', `Nível ${LANGUAGE_LEVEL_LABELS[best.level]} atende ao nível ${wanted}.`, ev);
  if (diff === -1) return result(req, 'partially_met', `Nível ${LANGUAGE_LEVEL_LABELS[best.level]} está um nível abaixo de ${wanted}.`, ev);
  return result(req, 'not_met', `Nível declarado (${LANGUAGE_LEVEL_LABELS[best.level]}) abaixo do exigido (${wanted}).`, ev);
}

// ---------------------------------------------------------------------------
// Fit cultural: compara apenas características explícitas da vaga com preferências declaradas.
// ---------------------------------------------------------------------------

const prefEvidence = (ctx: AssessContext, description: string): Evidence[] => [
  { profilePath: 'preferences', description, validationStatus: ctx.index.profile.preferences.provenance.status },
];
const NO_PREF = 'Você não declarou preferência sobre este aspecto.';
const MODE_LABEL: Record<string, string> = { remote: 'remoto', hybrid: 'híbrido', onsite: 'presencial' };

export function assessCulture(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  const prefs = ctx.index.profile.preferences;
  const personal = ctx.index.profile.personal;
  switch (req.kind) {
    case 'work_mode': {
      if (!prefs.workModes.length) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Modalidades aceitas: ${prefs.workModes.map((m) => MODE_LABEL[m]).join(', ')}`);
      if (prefs.workModes.includes(req.workMode!)) return result(req, 'met', `A vaga oferece modalidade ${MODE_LABEL[req.workMode!]}, que você aceita.`, ev);
      if (ctx.jobWorkModes.some((m) => prefs.workModes.includes(m as never))) {
        return result(req, 'not_applicable', 'A vaga também oferece outra modalidade que você aceita.');
      }
      return result(req, 'not_met', `A vaga é ${MODE_LABEL[req.workMode!]}, modalidade que você não marcou como aceita.`, ev);
    }
    case 'location': {
      if (ctx.jobWorkModes.length === 1 && ctx.jobWorkModes[0] === 'remote') return result(req, 'not_applicable', 'Vaga remota: local não é restrição.');
      const places = [...prefs.preferredLocations, personal.city].map(normalizeText).filter(Boolean);
      const loc = normalizeText(req.cultureValue ?? '');
      if (!places.length && prefs.willingToRelocate === null) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Locais: ${[...prefs.preferredLocations, personal.city].filter(Boolean).join(', ') || '—'}; mudança: ${prefs.willingToRelocate === null ? 'não declarado' : prefs.willingToRelocate ? 'sim' : 'não'}`);
      if (places.some((p) => loc.includes(p) || p.includes(loc))) return result(req, 'met', `O local da vaga (${req.cultureValue}) corresponde às suas preferências.`, ev);
      if (prefs.willingToRelocate === true) return result(req, 'partially_met', `Local diferente do preferido, mas você aceita mudança.`, ev);
      if (prefs.willingToRelocate === false) return result(req, 'not_met', `Local (${req.cultureValue}) fora das suas preferências e você não aceita mudança.`, ev);
      return result(req, 'not_proven', `Local (${req.cultureValue}) diferente dos seus locais preferidos.`, ev, { uncertainty: 'Disponibilidade para mudança não declarada.' });
    }
    case 'travel': {
      if (!prefs.travelAvailability) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Disponibilidade para viagens: ${prefs.travelAvailability}`);
      if (prefs.travelAvailability === 'none') return result(req, 'not_met', 'A vaga envolve viagens e você declarou não ter disponibilidade.', ev);
      if (req.travel === 'frequent' && prefs.travelAvailability === 'occasional') return result(req, 'partially_met', 'A vaga indica viagens frequentes; você declarou disponibilidade ocasional.', ev);
      return result(req, 'met', 'Sua disponibilidade para viagens é compatível.', ev);
    }
    case 'autonomy': {
      if (!prefs.autonomy) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Preferência de autonomia: ${prefs.autonomy}`);
      if (prefs.autonomy === 'high') return result(req, 'met', 'A vaga descreve autonomia, alinhada à sua preferência.', ev);
      if (prefs.autonomy === 'moderate') return result(req, 'partially_met', 'A vaga descreve alta autonomia; você prefere autonomia moderada.', ev);
      return result(req, 'not_met', 'A vaga descreve alta autonomia; você prefere ambientes mais estruturados.', ev);
    }
    case 'collaboration': {
      if (!prefs.collaboration) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Preferência de colaboração: ${prefs.collaboration}`);
      if (prefs.collaboration === 'independent') return result(req, 'partially_met', 'A vaga enfatiza trabalho em equipe; você prefere trabalhar de forma mais independente.', ev);
      return result(req, 'met', 'A vaga enfatiza colaboração, compatível com sua preferência.', ev);
    }
    case 'schedule': {
      if (!prefs.schedule) return result(req, 'not_applicable', NO_PREF);
      const ev = prefEvidence(ctx, `Preferência de horário: ${prefs.schedule}`);
      if (req.cultureValue === 'shifts') {
        return prefs.schedule === 'shifts_ok'
          ? result(req, 'met', 'Você aceita escalas/turnos.', ev)
          : result(req, 'not_met', 'A vaga envolve escala, turnos ou fins de semana, e você não indicou aceitar.', ev);
      }
      if (req.cultureValue === 'fixed' && prefs.schedule === 'flexible') return result(req, 'partially_met', 'A vaga tem horário fixo; você prefere flexibilidade.', ev);
      return result(req, 'met', 'Horário compatível com sua preferência.', ev);
    }
    default:
      return result(req, 'not_applicable', 'Aspecto não avaliado.');
  }
}

export function assessRequirement(req: JobRequirement, ctx: AssessContext): RequirementAssessment {
  switch (req.kind) {
    case 'skill':
      return assessSkill(req, ctx);
    case 'years_experience':
    case 'seniority':
      return assessYears(req, ctx);
    case 'responsibility':
      return assessResponsibility(req, ctx);
    case 'education':
      return assessEducation(req, ctx);
    case 'certification':
      return assessCertification(req, ctx);
    case 'language':
      return assessLanguage(req, ctx);
    case 'other':
      return assessOther(req, ctx);
    default:
      return assessCulture(req, ctx);
  }
}
