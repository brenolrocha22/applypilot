import type { Evidence } from '../model/fit';
import type { Experience, Profile } from '../model/profile';
import { findSkillMentions, getSkill, resolveSkillId, vocabularyFromNames, type SkillDefinition } from '../knowledge/skills';
import { meaningfulTokens, normalizeText } from '../knowledge/normalize';

/**
 * Índice das evidências do perfil, construído uma vez por análise.
 * Cada competência aponta para os itens do perfil que a comprovam.
 */
export interface ProfileIndex {
  profile: Profile;
  /** skillId → evidências diretas. */
  skillEvidence: Map<string, Evidence[]>;
  /** skillId → ids de experiências em que a competência aparece. */
  skillExperiences: Map<string, Set<string>>;
  /** Vocabulário das competências do perfil fora do dicionário. */
  customVocabulary: SkillDefinition[];
  experienceTokens: Map<string, Set<string>>;
  /** Tokens de todo o perfil (resumo, competências, experiências) para linhas não estruturadas. */
  allTokens: Set<string>;
}

export function experienceText(e: Experience): string {
  return [e.title, e.company, e.description, ...e.achievements, ...e.skills].join('\n');
}

const SNIPPET_RADIUS = 60;
function snippetAround(text: string, start: number, end: number): string {
  const s = Math.max(0, start - SNIPPET_RADIUS);
  const e = Math.min(text.length, end + SNIPPET_RADIUS);
  return `${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\s+/g, ' ').trim()}${e < text.length ? '…' : ''}`;
}

export function buildProfileIndex(profile: Profile): ProfileIndex {
  const customVocabulary = vocabularyFromNames([
    ...profile.skills.map((s) => s.name),
    ...profile.experiences.flatMap((e) => e.skills),
  ]);
  const skillEvidence = new Map<string, Evidence[]>();
  const skillExperiences = new Map<string, Set<string>>();
  const add = (skillId: string, ev: Evidence) => {
    const list = skillEvidence.get(skillId) ?? [];
    if (!list.some((x) => x.profilePath === ev.profilePath)) list.push(ev);
    skillEvidence.set(skillId, list);
  };
  const idFor = (name: string) => resolveSkillId(name) ?? `custom:${normalizeText(name)}`;

  for (const s of profile.skills) {
    if (!s.name.trim()) continue;
    const details = [s.level && `nível ${s.level}`, s.yearsOfExperience !== undefined && `${s.yearsOfExperience} ano(s)`].filter(Boolean).join(', ');
    add(idFor(s.name), {
      profilePath: `skills/${s.id}`,
      description: `Competência declarada: ${s.name}${details ? ` (${details})` : ''}`,
      validationStatus: s.provenance.status,
    });
  }

  for (const e of profile.experiences) {
    const label = `${e.title}${e.company ? ` — ${e.company}` : ''}`;
    const link = (skillId: string) => {
      const set = skillExperiences.get(skillId) ?? new Set<string>();
      set.add(e.id);
      skillExperiences.set(skillId, set);
    };
    for (const name of e.skills) {
      if (!name.trim()) continue;
      const id = idFor(name);
      link(id);
      add(id, { profilePath: `experiences/${e.id}`, description: `Usada na experiência: ${label}`, validationStatus: e.provenance.status });
    }
    const text = [e.title, e.description, ...e.achievements].join('\n');
    for (const m of findSkillMentions(text, customVocabulary)) {
      link(m.skillId);
      add(m.skillId, {
        profilePath: `experiences/${e.id}`,
        description: `Mencionada na experiência: ${label}`,
        snippet: snippetAround(text, m.start, m.end),
        validationStatus: e.provenance.status,
      });
    }
  }

  for (const c of profile.certifications) {
    for (const m of findSkillMentions(c.name, customVocabulary)) {
      add(m.skillId, { profilePath: `certifications/${c.id}`, description: `Certificação: ${c.name}`, validationStatus: c.provenance.status });
    }
  }
  for (const c of profile.courses) {
    for (const m of findSkillMentions(c.name, customVocabulary)) {
      add(m.skillId, { profilePath: `courses/${c.id}`, description: `Curso: ${c.name}`, validationStatus: c.provenance.status });
    }
  }
  if (profile.summary.text) {
    for (const m of findSkillMentions(profile.summary.text, customVocabulary)) {
      add(m.skillId, {
        profilePath: 'summary',
        description: 'Mencionada no resumo profissional',
        snippet: snippetAround(profile.summary.text, m.start, m.end),
        validationStatus: profile.summary.provenance.status,
      });
    }
  }

  const experienceTokens = new Map(profile.experiences.map((e) => [e.id, new Set(meaningfulTokens(experienceText(e)))]));
  const allTokens = new Set<string>([
    ...meaningfulTokens(profile.summary.text),
    ...profile.skills.flatMap((s) => meaningfulTokens(s.name)),
    ...Array.from(experienceTokens.values()).flatMap((s) => Array.from(s)),
  ]);

  return { profile, skillEvidence, skillExperiences, customVocabulary, experienceTokens, allTokens };
}

/** Todas as competências que o perfil possui e que implicam `targetId` (fechamento transitivo). */
export function implyingSkills(index: ProfileIndex, targetId: string): string[] {
  const result: string[] = [];
  for (const owned of index.skillEvidence.keys()) {
    if (owned === targetId) continue;
    const visited = new Set<string>();
    const stack = [owned];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const def = getSkill(cur);
      for (const imp of def?.implies ?? []) {
        if (imp === targetId) {
          result.push(owned);
          stack.length = 0;
          break;
        }
        stack.push(imp);
      }
    }
  }
  return result;
}

/** Competências do perfil semelhantes (mas não equivalentes) a `targetId`. */
export function relatedSkills(index: ProfileIndex, targetId: string): string[] {
  const target = getSkill(targetId);
  const out: string[] = [];
  for (const owned of index.skillEvidence.keys()) {
    if (owned === targetId) continue;
    const def = getSkill(owned);
    if (target?.related?.includes(owned) || def?.related?.includes(targetId)) out.push(owned);
  }
  return out;
}
