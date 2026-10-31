import type { Skill } from '../model/profile';
import { newId } from '../profile/factory';
import { normalizeText } from '../knowledge/normalize';
import { getSkill, resolveSkillId } from '../knowledge/skills';
import type { ResumeDraft } from '../resume/parser';

/**
 * Competências lidas da página "Competências" do próprio perfil do LinkedIn, aberta pelo usuário
 * (linkedin.com/in/<perfil>/details/skills/). Só roda após o clique na extensão; nenhuma navegação automática.
 */

const SKILLS_PAGE_RE = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/([^/?#]+)\/details\/skills\/?/i;
const PROFILE_RE = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/([^/?#]+)/i;

export function linkedInProfileSlug(url: string | undefined): string | null {
  const m = url?.match(PROFILE_RE);
  return m ? decodeURIComponent(m[2]!).toLowerCase() : null;
}

export function isLinkedInSkillsPage(url: string | undefined): boolean {
  return !!url && SKILLS_PAGE_RE.test(url);
}

export function linkedInSkillsUrl(url: string): string | null {
  const slug = url.match(PROFILE_RE)?.[2];
  return slug ? `https://www.linkedin.com/in/${slug}/details/skills/` : null;
}

/** Textos da página que não são competências: abas, contadores, endossos, botões. */
const NOISE = [
  /^(todas?|all|competencias?|skills|conhecimento do setor|industry knowledge|ferramentas e tecnologias|tools (&|and) technologies|competencias interpessoais|interpersonal skills|outras competencias|other skills|idiomas|languages)$/,
  /(endoss|endorse|recomend|recommend|experiencias? (em|na|no)|experiences? (at|across)|^\d|mostrar|^show |^ver |avaliacao|assessment|aprovado|passed|seguir|follow|mensagem|message|conectar|connect)/,
];

export function cleanSkillNames(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80) continue;
    const norm = normalizeText(name);
    if (NOISE.some((re) => re.test(norm))) continue;
    const key = resolveSkillId(name) ?? norm;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 300) break;
  }
  return out;
}

export function linkedInSkillsToDraft(texts: string[], now = new Date().toISOString()): ResumeDraft {
  const skills: Skill[] = cleanSkillNames(texts).map((name) => ({
    id: newId(),
    name,
    category: getSkill(resolveSkillId(name) ?? '')?.category ?? 'technical',
    provenance: { source: 'linkedin_page', status: 'extracted', sourceSnippet: `Página de competências do LinkedIn: ${name}`, updatedAt: now },
  }));
  return {
    source: 'linkedin_page',
    personal: {},
    summary: null,
    experiences: [],
    education: [],
    skills,
    languages: [],
    certifications: [],
    courses: [],
    preferences: null,
    warnings: skills.length ? [] : ['Nenhuma competência encontrada nesta página.'],
  };
}
