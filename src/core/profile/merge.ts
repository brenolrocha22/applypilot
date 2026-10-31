import type { Profile, ProfileListKey } from '../model/profile';
import { resolveLanguageId } from '../knowledge/languages';
import { normalizeText } from '../knowledge/normalize';
import { resolveSkillId } from '../knowledge/skills';
import type { PersonalField, ResumeDraft } from '../resume/parser';

export interface MergeSelection {
  personal: PersonalField[];
  summary: boolean;
  /** Aplicar preferências declaradas no currículo (só preenche campos não declarados). */
  preferences?: boolean;
  /** Ids dos itens do rascunho escolhidos pelo usuário, por lista. */
  items: Partial<Record<ProfileListKey, string[]>>;
}

export interface MergeConflict {
  field: string;
  current: string;
  incoming: string;
}

export interface MergeResult {
  profile: Profile;
  added: Record<ProfileListKey, number>;
  skippedDuplicates: number;
  conflicts: MergeConflict[];
}

const PERSONAL_FIELDS: PersonalField[] = ['fullName', 'headline', 'email', 'phone', 'city', 'state', 'country', 'linkedinUrl', 'githubUrl', 'portfolioUrl'];

const keyFns:Record<ProfileListKey, (item: never) => string> = {
  experiences: (e: Profile['experiences'][number]) => `${normalizeText(e.title)}|${normalizeText(e.company)}|${e.startDate ?? ''}`,
  education: (e: Profile['education'][number]) => `${normalizeText(e.institution)}|${normalizeText(e.degree)}`,
  skills: (s: Profile['skills'][number]) => resolveSkillId(s.name) ?? normalizeText(s.name),
  languages: (l: Profile['languages'][number]) => resolveLanguageId(l.name) ?? normalizeText(l.name),
  certifications: (c: Profile['certifications'][number]) => normalizeText(c.name),
  courses: (c: Profile['courses'][number]) => normalizeText(c.name),
};

/**
 * Incorpora itens selecionados do rascunho ao perfil.
 * - Campos pessoais só são preenchidos se estiverem vazios; valores diferentes viram conflito (não sobrescreve).
 * - Itens de lista são adicionados com o estado de validação do rascunho (nunca "confirmado").
 * - Duplicatas são ignoradas.
 */
export function mergeDraftIntoProfile(profile: Profile, draft: ResumeDraft, selection: MergeSelection, now: string): MergeResult {
  const next: Profile = structuredClone(profile);
  const conflicts: MergeConflict[] = [];
  const added = { experiences: 0, education: 0, skills: 0, languages: 0, certifications: 0, courses: 0 } as Record<ProfileListKey, number>;
  let skippedDuplicates = 0;
  let personalChanged = false;
  const wasEmpty = PERSONAL_FIELDS.every((f) => !profile.personal[f].trim());

  for (const field of selection.personal) {
    const incoming = draft.personal[field];
    if (!incoming) continue;
    const current = next.personal[field];
    if (!current.trim()) {
      next.personal[field] = incoming.value;
      personalChanged = true;
    } else if (normalizeText(current) !== normalizeText(incoming.value)) {
      conflicts.push({ field: `personal.${field}`, current, incoming: incoming.value });
    }
  }
  // Bloco antes vazio ⇒ "extraído". Bloco com dados + campos novos do documento ⇒ "pendente de confirmação".
  if (personalChanged) {
    next.personal.provenance = wasEmpty
      ? { source: draft.source, status: 'extracted', updatedAt: now }
      : { ...next.personal.provenance, status: 'pending', updatedAt: now };
  }

  if (selection.summary && draft.summary) {
    if (!next.summary.text.trim()) {
      next.summary = { text: draft.summary.value, provenance: { source: draft.source, status: 'extracted', sourceSnippet: draft.summary.snippet, updatedAt: now } };
    } else if (normalizeText(next.summary.text) !== normalizeText(draft.summary.value)) {
      conflicts.push({ field: 'summary', current: next.summary.text, incoming: draft.summary.value });
    }
  }

  if (selection.preferences && draft.preferences) {
    const pref = next.preferences;
    const wasPrefEmpty = !pref.workModes.length && pref.travelAvailability === null && pref.willingToRelocate === null;
    let changed = false;
    if (draft.preferences.workModes?.length && !pref.workModes.length) {
      pref.workModes = [...draft.preferences.workModes];
      changed = true;
    }
    if (draft.preferences.travelAvailability && pref.travelAvailability === null) {
      pref.travelAvailability = draft.preferences.travelAvailability;
      changed = true;
    }
    if (draft.preferences.willingToRelocate !== undefined && pref.willingToRelocate === null) {
      pref.willingToRelocate = draft.preferences.willingToRelocate;
      changed = true;
    }
    if (changed) {
      pref.provenance = wasPrefEmpty
        ? { source: draft.source, status: 'extracted', sourceSnippet: draft.preferences.snippet, updatedAt: now }
        : { ...pref.provenance, status: 'pending', updatedAt: now };
    }
  }

  (Object.keys(keyFns) as ProfileListKey[]).forEach((key) => {
    const chosen = new Set(selection.items[key] ?? []);
    const keyFn = keyFns[key] as (i: unknown) => string;
    const existing = new Set((next[key] as unknown[]).map(keyFn));
    for (const item of draft[key] as { id: string }[]) {
      if (!chosen.has(item.id)) continue;
      const k = keyFn(item);
      if (existing.has(k)) {
        skippedDuplicates++;
        continue;
      }
      existing.add(k);
      (next[key] as unknown[]).push(structuredClone(item));
      added[key]++;
    }
  });

  next.updatedAt = now;
  return { profile: next, added, skippedDuplicates, conflicts };
}
