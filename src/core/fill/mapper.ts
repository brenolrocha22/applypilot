import type { Profile } from '../model/profile';
import { EDUCATION_LEVEL_LABELS, educationRank } from '../knowledge/education';
import { LANGUAGE_LEVEL_LABELS } from '../knowledge/languages';
import { normalizeText } from '../knowledge/normalize';
import { resolveLanguageId } from '../knowledge/languages';
import { totalYears } from '../profile/dates';
import type { FieldDescriptor, FillAction, FillPlanItem, MatchCandidate, ProfileFieldKey } from './types';

/**
 * Mapeamento de campos de formulário → propriedades do perfil.
 * Independente do DOM: recebe descrições de campos e devolve um plano revisável.
 * Nunca envia formulários e nunca preenche campos de segurança (senha, CAPTCHA, documentos).
 */

interface CatalogEntry {
  key: ProfileFieldKey;
  label: string;
  autocomplete: string[];
  pattern: RegExp;
  exclude?: RegExp;
  /** Dado que exige revisão e nunca é pré-selecionado (ex.: pretensão salarial). */
  sensitive?: boolean;
}

export const FIELD_CATALOG: CatalogEntry[] = [
  { key: 'firstName', label: 'Primeiro nome', autocomplete: ['given-name'], pattern: /\b(primeiro nome|first[ _-]?name|given[ _-]?name|fname)\b/ },
  { key: 'lastName', label: 'Sobrenome', autocomplete: ['family-name'], pattern: /\b(sobrenome|ultimo nome|last[ _-]?name|family[ _-]?name|surname|lname)\b/ },
  {
    key: 'fullName',
    label: 'Nome completo',
    autocomplete: ['name'],
    pattern: /\b(nome completo|full[ _-]?name|seu nome|nome|name)\b/,
    exclude: /(primeiro|sobrenome|ultimo|first|last|given|family|empresa|company|usuario|user|social|mae|pai|curso|instituicao|arquivo|file|referencia)/,
  },
  { key: 'email', label: 'E-mail', autocomplete: ['email'], pattern: /\be[ -]?mail\b/ },
  { key: 'phone', label: 'Telefone', autocomplete: ['tel', 'tel-national'], pattern: /\b(telefone|celular|whatsapp|phone|mobile|tel|fone)\b/ },
  { key: 'city', label: 'Cidade', autocomplete: ['address-level2'], pattern: /\b(cidade|municipio|city)\b/ },
  { key: 'state', label: 'Estado/UF', autocomplete: ['address-level1'], pattern: /\b(estado|uf|state|province)\b/, exclude: /(civil|marital)/ },
  { key: 'country', label: 'País', autocomplete: ['country-name', 'country'], pattern: /\b(pais|country)\b/ },
  { key: 'location', label: 'Localização', autocomplete: [], pattern: /\b(localizacao|location|onde (voce )?mora|where do you live)\b/ },
  { key: 'linkedinUrl', label: 'LinkedIn', autocomplete: [], pattern: /linkedin/ },
  { key: 'githubUrl', label: 'GitHub', autocomplete: [], pattern: /github/ },
  { key: 'portfolioUrl', label: 'Portfólio/site', autocomplete: ['url'], pattern: /\b(portfolio|site|website|personal (site|url|website))\b/, exclude: /(linkedin|github)/ },
  { key: 'headline', label: 'Título profissional', autocomplete: [], pattern: /\b(titulo profissional|headline)\b/ },
  { key: 'summary', label: 'Resumo profissional', autocomplete: [], pattern: /\b(resumo( profissional)?|sobre (voce|mim)|about (you|me)|summary)\b/ },
  { key: 'currentTitle', label: 'Cargo atual', autocomplete: ['organization-title'], pattern: /\b(cargo atual|funcao atual|current (title|position|role)|job title|cargo)\b/, exclude: /(desejad|pretendid|desired|interesse)/ },
  { key: 'currentCompany', label: 'Empresa atual', autocomplete: ['organization'], pattern: /\b(empresa atual|empregador atual|current (company|employer)|empresa|company)\b/, exclude: /(nome da empresa onde|referencia)/ },
  { key: 'yearsOfExperience', label: 'Anos de experiência', autocomplete: [], pattern: /(anos de experiencia|years of experience|tempo de experiencia)/ },
  { key: 'highestEducation', label: 'Escolaridade', autocomplete: [], pattern: /\b(escolaridade|nivel de (ensino|formacao)|grau de instrucao|formacao academica|education level|highest (degree|education))\b/ },
  { key: 'englishLevel', label: 'Nível de inglês', autocomplete: [], pattern: /\b(ingles|english)\b/ },
  { key: 'desiredSalary', label: 'Pretensão salarial', autocomplete: [], pattern: /(pretensao salarial|expectativa salarial|salario|salary|remuneracao)/, sensitive: true },
  { key: 'workMode', label: 'Modalidade de trabalho', autocomplete: [], pattern: /(modalidade|modelo de trabalho|work (mode|model|arrangement))/ },
  { key: 'willingToRelocate', label: 'Disponibilidade para mudança', autocomplete: [], pattern: /(mudanca|relocat|mudar de cidade)/ },
];

export const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = Object.fromEntries(FIELD_CATALOG.map((e) => [e.key, e.label])) as Record<ProfileFieldKey, string>;

/** Campos que nunca são preenchidos automaticamente. */
const BLOCKED_PATTERN = /(senha|password|passwd|captcha|recaptcha|\bcpf\b|\brg\b|\bssn\b|social security|passaporte|passport|cartao|credit card|card number|\bcvv\b|\bcvc\b|\btoken\b|\botp\b|codigo de verificacao|verification code|\bpis\b|\bnis\b)/;
const SUPPORTED_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search', 'number']);

const CONFIDENCE = { autocomplete: 0.95, label: 0.85, nameOrId: 0.75, placeholder: 0.65 } as const;
export const AUTO_SELECT_THRESHOLD = 0.75;
const AMBIGUITY_MARGIN = 0.1;

function humanize(s: string): string {
  // "firstName" / "first_name" → "first name"
  return normalizeText(s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-[\].]+/g, ' '));
}

export function matchField(field: FieldDescriptor): MatchCandidate[] {
  const sources: [string, number, string][] = [
    [humanize(field.label), CONFIDENCE.label, 'rótulo'],
    [humanize(field.ariaLabel), CONFIDENCE.label, 'rótulo acessível'],
    [humanize(field.name), CONFIDENCE.nameOrId, 'atributo name'],
    [humanize(field.id), CONFIDENCE.nameOrId, 'atributo id'],
    [humanize(field.placeholder), CONFIDENCE.placeholder, 'placeholder'],
  ];
  const ac = field.autocomplete.toLowerCase().split(/\s+/).pop() ?? '';
  const best = new Map<ProfileFieldKey, MatchCandidate>();
  for (const entry of FIELD_CATALOG) {
    let cand: MatchCandidate | null = null;
    if (ac && entry.autocomplete.includes(ac)) {
      cand = { profileField: entry.key, confidence: CONFIDENCE.autocomplete, reason: `autocomplete="${ac}"` };
    } else {
      for (const [text, conf, where] of sources) {
        if (!text || !entry.pattern.test(text) || entry.exclude?.test(text)) continue;
        if (!cand || conf > cand.confidence) cand = { profileField: entry.key, confidence: conf, reason: `${where}: "${text}"` };
      }
    }
    if (cand) best.set(entry.key, cand);
  }
  return Array.from(best.values()).sort((a, b) => b.confidence - a.confidence);
}

export interface ProfileValue {
  value: string;
  /** O dado vem de informação ainda não confirmada pelo usuário. */
  unconfirmed: boolean;
}

const MODE_LABELS: Record<string, string[]> = { remote: ['remoto', 'remote', 'home office'], hybrid: ['hibrido', 'hybrid'], onsite: ['presencial', 'on-site', 'onsite'] };

export function profileValue(profile: Profile, key: ProfileFieldKey, referenceDate = new Date()): ProfileValue | null {
  const p = profile.personal;
  const personalUnconfirmed = p.provenance.status !== 'confirmed';
  const val = (v: string | null | undefined, unconfirmed = personalUnconfirmed): ProfileValue | null => (v && v.trim() ? { value: v.trim(), unconfirmed } : null);
  const current = [...profile.experiences].sort((a, b) => Number(b.current) - Number(a.current) || (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0];
  switch (key) {
    case 'fullName':
      return val(p.fullName);
    case 'firstName':
      return val(p.fullName.trim().split(/\s+/)[0]);
    case 'lastName': {
      const parts = p.fullName.trim().split(/\s+/);
      return parts.length > 1 ? val(parts.slice(1).join(' ')) : null;
    }
    case 'email':
    case 'phone':
    case 'city':
    case 'state':
    case 'country':
    case 'linkedinUrl':
    case 'githubUrl':
    case 'portfolioUrl':
    case 'headline':
      return val(p[key]);
    case 'location':
      return val([p.city, p.state, p.country].filter(Boolean).join(', '));
    case 'summary':
      return val(profile.summary.text, profile.summary.provenance.status !== 'confirmed');
    case 'currentTitle':
      return current ? val(current.title, current.provenance.status !== 'confirmed') : null;
    case 'currentCompany':
      return current ? val(current.company, current.provenance.status !== 'confirmed') : null;
    case 'yearsOfExperience': {
      if (!profile.experiences.length) return null;
      const y = totalYears(profile.experiences, referenceDate);
      return { value: String(Math.floor(y.years)), unconfirmed: profile.experiences.some((e) => e.provenance.status !== 'confirmed') };
    }
    case 'highestEducation': {
      const done = profile.education.filter((e) => e.status === 'completed');
      if (!done.length) return null;
      const top = done.reduce((a, b) => (educationRank(b.level) > educationRank(a.level) ? b : a));
      return val(EDUCATION_LEVEL_LABELS[top.level], top.provenance.status !== 'confirmed');
    }
    case 'englishLevel': {
      const en = profile.languages.find((l) => resolveLanguageId(l.name) === 'english');
      return en ? val(LANGUAGE_LEVEL_LABELS[en.level], en.provenance.status !== 'confirmed') : null;
    }
    case 'desiredSalary':
      return val(profile.preferences.desiredSalary, profile.preferences.provenance.status !== 'confirmed');
    case 'workMode': {
      const m = profile.preferences.workModes[0];
      return m ? val(MODE_LABELS[m]?.[0], profile.preferences.provenance.status !== 'confirmed') : null;
    }
    case 'willingToRelocate': {
      const r = profile.preferences.willingToRelocate;
      return r === null ? null : val(r ? 'Sim' : 'Não', profile.preferences.provenance.status !== 'confirmed');
    }
  }
}

/** Escolhe a opção de um <select> que corresponde ao valor do perfil. */
export function chooseOption(options: FieldDescriptor['options'], key: ProfileFieldKey, value: string): string | null {
  const wanted = [normalizeText(value)];
  if (key === 'workMode') wanted.push(...(Object.values(MODE_LABELS).find((l) => l.includes(normalizeText(value))) ?? []));
  if (key === 'willingToRelocate') wanted.push(value === 'Sim' ? 'yes' : 'no', value === 'Sim' ? 's' : 'n');
  if (key === 'highestEducation') wanted.push(normalizeText(value).split(/[ (/]/)[0]!);
  const norm = options.map((o) => ({ value: o.value, label: normalizeText(o.label), raw: normalizeText(o.value) }));
  const exact = norm.find((o) => wanted.includes(o.label) || wanted.includes(o.raw));
  if (exact) return exact.value;
  const partial = norm.filter((o) => o.label && wanted.some((w) => w.length >= 3 && (o.label.startsWith(w) || w.startsWith(o.label))));
  return partial.length === 1 ? partial[0]!.value : null;
}

function blockedReason(field: FieldDescriptor): string | null {
  if (field.disabled) return 'Campo desabilitado ou somente leitura.';
  if (field.tag === 'input' && !SUPPORTED_INPUT_TYPES.has(field.type)) {
    return field.type === 'password' ? 'Campo de senha: nunca preenchido.' : `Tipo de campo "${field.type}" não suportado nesta versão.`;
  }
  const text = [field.label, field.ariaLabel, field.name, field.id, field.placeholder].map(humanize).join(' ');
  if (BLOCKED_PATTERN.test(text)) return 'Dado sensível ou controle de segurança: preencha manualmente.';
  return null;
}

/** Monta o item do plano para um campo, opcionalmente forçando um campo do perfil (escolha manual do usuário). */
export function planField(field: FieldDescriptor, profile: Profile, forced?: ProfileFieldKey, referenceDate = new Date()): FillPlanItem {
  const base = { field, candidates: [] as MatchCandidate[], value: null, confidence: 0, selectedByDefault: false, requiresReview: false };
  const blocked = blockedReason(field);
  if (blocked) return { ...base, profileField: null, action: 'blocked', reason: blocked };

  const candidates = matchField(field);
  const item = (action: FillAction, reason: string, extra: Partial<FillPlanItem> = {}): FillPlanItem => ({
    ...base,
    candidates,
    profileField: null,
    action,
    reason,
    ...extra,
  });

  let chosen: MatchCandidate | undefined;
  if (forced) {
    chosen = { profileField: forced, confidence: 1, reason: 'escolhido por você' };
  } else {
    if (!candidates.length) return item('no_match', 'Nenhuma propriedade do perfil corresponde a este campo.');
    const [first, second] = candidates;
    if (second && first!.confidence - second.confidence < AMBIGUITY_MARGIN) {
      return item('ambiguous', `Campo ambíguo: pode ser ${candidates.map((c) => PROFILE_FIELD_LABELS[c.profileField]).join(' ou ')}.`, { requiresReview: true });
    }
    chosen = first!;
  }

  const entry = FIELD_CATALOG.find((e) => e.key === chosen!.profileField)!;
  const pv = profileValue(profile, chosen.profileField, referenceDate);
  const common = { profileField: chosen.profileField, confidence: chosen.confidence };
  if (!pv) return item('no_profile_value', `Seu perfil não tem "${entry.label}".`, common);

  let value = pv.value;
  if (field.tag === 'select') {
    const opt = chooseOption(field.options, chosen.profileField, pv.value);
    if (opt === null) return item('ambiguous', `Nenhuma opção corresponde a "${pv.value}".`, { ...common, requiresReview: true });
    value = opt;
  }

  const notes = [`Correspondência por ${chosen.reason}.`];
  if (pv.unconfirmed) notes.push('Dado ainda não confirmado no perfil.');
  if (entry.sensitive) notes.push('Dado sensível: revise antes de preencher.');
  const requiresReview = chosen.confidence < AUTO_SELECT_THRESHOLD || pv.unconfirmed || !!entry.sensitive;

  if (field.currentValue.trim()) {
    if (normalizeText(field.currentValue) === normalizeText(value)) {
      return item('same_value', 'O campo já contém este valor.', { ...common, value });
    }
    return item('skip_has_value', 'O campo já tem outro valor; só será substituído se você marcar.', { ...common, value, requiresReview: true });
  }

  return item('fill', notes.join(' '), {
    ...common,
    value,
    requiresReview,
    selectedByDefault: chosen.confidence >= AUTO_SELECT_THRESHOLD && !entry.sensitive,
  });
}

export function buildFillPlan(fields: FieldDescriptor[], profile: Profile, referenceDate = new Date()): FillPlanItem[] {
  return fields.map((f) => planField(f, profile, undefined, referenceDate));
}
