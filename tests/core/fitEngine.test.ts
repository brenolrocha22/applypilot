import { describe, expect, it } from 'vitest';
import { analyzeJob, computeFit } from '../../src/core/fit/engine';
import { parseJob } from '../../src/core/job/parser';
import { createEmptyProfile } from '../../src/core/profile/factory';
import { DEFAULT_DIMENSION_WEIGHTS } from '../../src/core/fit/weights';
import type { RequirementAssessment } from '../../src/core/model/fit';
import { JOB, makeProfile, NOW, REFERENCE_DATE } from '../fixtures/data';

const opts = { referenceDate: REFERENCE_DATE, now: NOW };

function assessmentsOf(report: ReturnType<typeof computeFit>): RequirementAssessment[] {
  return report.dimensions.flatMap((d) => d.assessments);
}

describe('computeFit — classificação dos requisitos', () => {
  const { report } = analyzeJob(makeProfile(), JOB, opts);
  const all = assessmentsOf(report);
  const bySkill = (id: string) => all.find((a) => a.requirement.skillId === id)!;

  it('competência declarada ⇒ atendido, com evidência rastreável', () => {
    const react = bySkill('react');
    expect(react.status).toBe('met');
    expect(react.evidence.map((e) => e.profilePath)).toContain('skills/sk-1');
    expect(react.justification).toMatch(/React/);
  });

  it('competência que implica outra ⇒ atendido com justificativa (MySQL ⇒ SQL)', () => {
    const sql = bySkill('sql');
    expect(sql.status).toBe('met');
    expect(sql.justification).toMatch(/MySQL/);
    expect(sql.uncertainty).toMatch(/Inferido/);
  });

  it('competência semelhante ⇒ no máximo parcialmente atendido (React ~ Vue.js)', () => {
    expect(bySkill('vue').status).toBe('partially_met');
    expect(bySkill('vue').uncertainty).toMatch(/não são consideradas equivalentes/);
  });

  it('competência ausente ⇒ não comprovado (nunca "não atendido")', () => {
    const next = bySkill('nextjs');
    expect(next.status).toBe('not_proven');
    expect(next.credit).toBe(0);
  });

  it('evidência extraída e não confirmada ⇒ sinalizada para confirmação, com confiança reduzida', () => {
    const k8s = bySkill('kubernetes'); // relacionado a Docker (extraído)
    expect(k8s.status).toBe('partially_met');
    expect(k8s.needsConfirmation).toBe(true);
    expect(k8s.confidence).toBe(0.8);
    expect(report.needsConfirmation).toContain(k8s);
  });

  it('nível de idioma declarado inferior ⇒ não atendido e destacado como bloqueio', () => {
    const en = all.find((a) => a.requirement.kind === 'language')!;
    expect(en.status).toBe('partially_met'); // intermediário é um nível abaixo de avançado
    expect(report.blockers).toContain(en);
    expect(en.requirement.eliminatory).toBe(true);
  });

  it('anos de experiência mesclam períodos e consideram emprego atual', () => {
    const years = all.find((a) => a.requirement.kind === 'years_experience')!;
    expect(years.status).toBe('met'); // 2019-06 → 2026-01 ≈ 6,6 anos
  });

  it('formação compatível ⇒ atendido com ressalva sobre área', () => {
    const edu = all.find((a) => a.requirement.kind === 'education')!;
    expect(edu.status).toBe('met');
    expect(edu.uncertainty).toMatch(/área/);
  });

  it('fit cultural compara somente preferências declaradas', () => {
    const culture = report.dimensions.find((d) => d.dimension === 'culture')!;
    expect(culture.evaluable).toBe(true);
    const mode = culture.assessments.find((a) => a.requirement.kind === 'work_mode')!;
    expect(mode.status).toBe('met');
  });
});

describe('computeFit — pontuação', () => {
  it('produz resultados idênticos para as mesmas entradas', () => {
    const a = analyzeJob(makeProfile(), JOB, opts);
    const b = analyzeJob(makeProfile(), JOB, opts);
    expect(a).toEqual(b);
  });

  it('pontuação geral é a média ponderada das dimensões avaliáveis', () => {
    const { report } = analyzeJob(makeProfile(), JOB, opts);
    const ev = report.dimensions.filter((d) => d.evaluable);
    const expected = Math.round(ev.reduce((s, d) => s + d.weight * d.score!, 0) / ev.reduce((s, d) => s + d.weight, 0));
    expect(report.overallScore).toBe(expected);
    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it('dimensão sem dados não vale zero: é excluída e a cobertura é reduzida', () => {
    const profile = makeProfile();
    profile.languages = [];
    const { report } = analyzeJob(profile, JOB, opts);
    const lang = report.dimensions.find((d) => d.dimension === 'language')!;
    expect(lang.evaluable).toBe(false);
    expect(lang.score).toBeNull();
    expect(lang.note).toMatch(/não conta como zero/);
    expect(report.coverage).toBeCloseTo(0.9, 5);
    // o requisito de idioma continua visível como bloqueio não comprovado
    expect(report.blockers.some((b) => b.requirement.kind === 'language' && b.status === 'not_proven')).toBe(true);
  });

  it('vaga sem informações culturais ⇒ "Dados insuficientes para avaliar o fit cultural"', () => {
    const parsed = parseJob({ ...JOB, description: 'Requisitos:\n- React' });
    const report = computeFit(makeProfile(), parsed, opts);
    const culture = report.dimensions.find((d) => d.dimension === 'culture')!;
    expect(culture.evaluable).toBe(false);
    expect(culture.note).toBe('Dados insuficientes para avaliar o fit cultural.');
    expect(report.overallScore).toBe(100);
  });

  it('preferências não declaradas tornam o fit cultural não avaliável (sem penalizar)', () => {
    const profile = makeProfile();
    profile.preferences = createEmptyProfile(NOW).preferences;
    profile.personal.city = ''; // a cidade também é usada para avaliar o local da vaga
    const { report } = analyzeJob(profile, JOB, opts);
    const culture = report.dimensions.find((d) => d.dimension === 'culture')!;
    expect(culture.evaluable).toBe(false);
    expect(culture.note).toMatch(/não declarou preferências/);
  });

  it('nota alta não esconde requisito obrigatório não atendido', () => {
    const profile = makeProfile();
    profile.languages = [{ id: 'l', name: 'Inglês', level: 'basic', provenance: profile.skills[0]!.provenance }];
    const parsed = parseJob({ ...JOB, description: 'Requisitos:\n- React\n- TypeScript\n- Inglês fluente (eliminatório)' });
    const report = computeFit(profile, parsed, opts);
    expect(report.overallScore).toBeGreaterThanOrEqual(70);
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]!.status).toBe('not_met');
    expect(report.recommendation.level).toBe('review_blockers');
    expect(report.counts.requiredMetPct).toBe(67);
  });

  it('perfil vazio ⇒ sem pontuação geral e recomendação de dados insuficientes', () => {
    const { report } = analyzeJob(createEmptyProfile(NOW), JOB, opts);
    expect(report.overallScore).toBeNull();
    expect(report.coverage).toBe(0);
    expect(report.recommendation.level).toBe('insufficient_data');
  });

  it('pesos configuráveis alteram a nota; pesos inválidos usam o padrão', () => {
    const parsed = parseJob(JOB);
    const base = computeFit(makeProfile(), parsed, opts);
    const techOnly = computeFit(makeProfile(), parsed, { ...opts, weights: { technical: 1, experience: 0, education: 0, language: 0, culture: 0 } });
    const tech = base.dimensions.find((d) => d.dimension === 'technical')!.score;
    expect(techOnly.overallScore).toBe(tech);
    const invalid = computeFit(makeProfile(), parsed, { ...opts, weights: { technical: -1, experience: 0, education: 0, language: 0, culture: 0 } });
    expect(invalid.weights).toEqual(DEFAULT_DIMENSION_WEIGHTS);
  });

  it('contagens separadas de obrigatórios, desejáveis, não comprovados e não atendidos', () => {
    const { report } = analyzeJob(makeProfile(), JOB, opts);
    const c = report.counts;
    expect(c.requiredTotal).toBeGreaterThan(0);
    expect(c.requiredMet).toBeLessThanOrEqual(c.requiredTotal);
    expect(c.preferredTotal).toBe(4); // Kubernetes, certificação AWS, AWS (citada na certificação), Vue.js
    expect(c.notProven).toBeGreaterThan(0);
    expect(report.recommendation.explanation[0]).toMatch(/Compatibilidade geral/);
  });

  it('lista experiências relevantes com termos correspondentes', () => {
    const { report } = analyzeJob(makeProfile(), JOB, opts);
    expect(report.relevantExperiences[0]?.experienceId).toBe('exp-1');
    expect(report.relevantExperiences[0]?.matchedTerms).toEqual(expect.arrayContaining(['React', 'TypeScript']));
  });

  it('sugestões de IA não contam como evidência', () => {
    const profile = makeProfile();
    profile.skills.push({ id: 'ai-1', name: 'Next.js', category: 'technical', provenance: { source: 'ai', status: 'ai_suggested', updatedAt: NOW } });
    const { report } = analyzeJob(profile, JOB, opts);
    const next = assessmentsOf(report).find((a) => a.requirement.skillId === 'nextjs')!;
    expect(next.status).toBe('not_proven');
    expect(next.needsConfirmation).toBe(true);
  });
});
