import type { Profile } from '../model/profile';
import { manualProvenance } from '../model/provenance';
import type { FillPlanItem, ProfileFieldKey } from './types';

/**
 * Caminho inverso do preenchimento: respostas que o usuário digitou num formulário e que o perfil
 * ainda não tem. Só entram no perfil os itens que o usuário marcar; nada existente é sobrescrito.
 */

const PERSONAL_KEYS = ['fullName', 'email', 'phone', 'city', 'state', 'country', 'linkedinUrl', 'githubUrl', 'portfolioUrl', 'headline'] as const;
type PersonalKey = (typeof PERSONAL_KEYS)[number];
const LEARNABLE = new Set<ProfileFieldKey>([...PERSONAL_KEYS, 'firstName', 'lastName', 'summary', 'desiredSalary']);
const MAX_LENGTH: Partial<Record<ProfileFieldKey, number>> = { summary: 5000 };

export interface FormAnswer {
  fieldKey: string;
  fieldLabel: string;
  profileField: ProfileFieldKey;
  value: string;
}

/** Campos de texto preenchidos na página, reconhecidos, para os quais o perfil não tem dado. */
export function learnableAnswers(plan: FillPlanItem[]): FormAnswer[] {
  const seen = new Set<ProfileFieldKey>();
  const out: FormAnswer[] = [];
  for (const i of plan) {
    const value = i.field.currentValue.trim();
    if (i.action !== 'no_profile_value' || !i.profileField || !LEARNABLE.has(i.profileField) || !value) continue;
    if (i.field.tag === 'select' || i.field.type === 'file' || seen.has(i.profileField)) continue;
    seen.add(i.profileField);
    out.push({ fieldKey: i.field.key, fieldLabel: i.field.label || i.field.name || i.field.id, profileField: i.profileField, value: value.slice(0, MAX_LENGTH[i.profileField] ?? 300) });
  }
  return out;
}

/**
 * Grava as respostas escolhidas, só em campos vazios.
 * Grupo antes vazio passa a "Confirmado" (o usuário digitou e escolheu guardar); grupo com outros dados mantém o estado que tinha.
 */
export function applyFormAnswers(profile: Profile, answers: FormAnswer[], now: string): { profile: Profile; saved: ProfileFieldKey[] } {
  const personal = { ...profile.personal };
  const personalWasEmpty = PERSONAL_KEYS.every((k) => !personal[k].trim());
  let summary = profile.summary;
  let preferences = profile.preferences;
  const saved: ProfileFieldKey[] = [];
  const get = (k: ProfileFieldKey) => answers.find((a) => a.profileField === k)?.value;

  for (const a of answers) {
    if ((PERSONAL_KEYS as readonly string[]).includes(a.profileField)) {
      const k = a.profileField as PersonalKey;
      if (!personal[k].trim()) {
        personal[k] = a.value;
        saved.push(k);
      }
    } else if (a.profileField === 'summary' && !summary.text.trim()) {
      summary = { text: a.value, provenance: manualProvenance(now) };
      saved.push('summary');
    } else if (a.profileField === 'desiredSalary' && !preferences.desiredSalary.trim()) {
      preferences = { ...preferences, desiredSalary: a.value };
      saved.push('desiredSalary');
    }
  }
  // Nome em dois campos (primeiro nome + sobrenome) vira o nome completo.
  const first = get('firstName');
  if (first && !personal.fullName.trim()) {
    personal.fullName = [first, get('lastName')].filter(Boolean).join(' ');
    saved.push('firstName');
    if (get('lastName')) saved.push('lastName');
  }
  const personalChanged = PERSONAL_KEYS.some((k) => personal[k] !== profile.personal[k]);
  if (personalChanged && personalWasEmpty) personal.provenance = manualProvenance(now);
  return {
    profile: { ...profile, personal: personalChanged ? personal : profile.personal, summary, preferences, updatedAt: now },
    saved,
  };
}
