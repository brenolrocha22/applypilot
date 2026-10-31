import {
  PROFILE_SCHEMA_VERSION,
  type EducationLevel,
  type LanguageLevel,
  type Profile,
  type SkillCategory,
} from '../model/profile';
import type { Provenance, SourceKind, ValidationStatus } from '../model/provenance';
import { createEmptyProfile, newId } from './factory';
import { isValidYearMonth, monthIndex } from './dates';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

/** Validação semântica do perfil (para exibir na UI e bloquear dados inconsistentes). */
export function validateProfile(p: Profile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: 'warning' });

  if (!p.personal.fullName.trim()) warn('personal.fullName', 'Nome completo não informado.');
  if (p.personal.email && !EMAIL_RE.test(p.personal.email)) err('personal.email', 'E-mail inválido.');
  if (p.personal.phone && p.personal.phone.replace(/\D/g, '').length < 8) err('personal.phone', 'Telefone parece incompleto.');
  for (const key of ['linkedinUrl', 'githubUrl', 'portfolioUrl'] as const) {
    const v = p.personal[key];
    if (v && !URL_RE.test(v)) err(`personal.${key}`, 'URL deve começar com http:// ou https://.');
  }

  const checkRange = (path: string, start: string | null, end: string | null, current = false) => {
    if (start && !isValidYearMonth(start)) err(`${path}.startDate`, 'Data inicial inválida (use AAAA-MM).');
    if (end && !isValidYearMonth(end)) err(`${path}.endDate`, 'Data final inválida (use AAAA-MM).');
    if (start && end && !current) {
      const s = monthIndex(start);
      const e = monthIndex(end);
      if (s !== null && e !== null && e < s) err(path, 'Data final anterior à data inicial.');
    }
  };

  p.experiences.forEach((e, i) => {
    const path = `experiences[${i}]`;
    if (!e.title.trim()) err(`${path}.title`, 'Cargo é obrigatório.');
    if (!e.company.trim()) warn(`${path}.company`, 'Empresa não informada.');
    if (!e.startDate) warn(`${path}.startDate`, 'Sem data de início: a experiência não entra no cálculo de anos.');
    if (!e.current && !e.endDate && e.startDate) warn(`${path}.endDate`, 'Sem data de término e não marcada como atual.');
    checkRange(path, e.startDate, e.endDate, e.current);
  });

  p.education.forEach((ed, i) => {
    const path = `education[${i}]`;
    if (!ed.institution.trim() && !ed.degree.trim()) err(path, 'Informe a instituição ou o curso.');
    checkRange(path, ed.startDate, ed.endDate);
  });

  const skillNames = new Set<string>();
  p.skills.forEach((s, i) => {
    const key = s.name.trim().toLowerCase();
    if (!key) err(`skills[${i}].name`, 'Nome da competência é obrigatório.');
    else if (skillNames.has(key)) warn(`skills[${i}].name`, `Competência duplicada: ${s.name}.`);
    skillNames.add(key);
    if (s.yearsOfExperience !== undefined && (s.yearsOfExperience < 0 || s.yearsOfExperience > 60)) {
      err(`skills[${i}].yearsOfExperience`, 'Anos de experiência fora do intervalo válido.');
    }
  });

  p.languages.forEach((l, i) => {
    if (!l.name.trim()) err(`languages[${i}].name`, 'Nome do idioma é obrigatório.');
  });
  p.certifications.forEach((c, i) => {
    if (!c.name.trim()) err(`certifications[${i}].name`, 'Nome da certificação é obrigatório.');
    if (c.credentialUrl && !URL_RE.test(c.credentialUrl)) err(`certifications[${i}].credentialUrl`, 'URL inválida.');
    checkRange(`certifications[${i}]`, c.issueDate, c.expirationDate);
  });
  p.courses.forEach((c, i) => {
    if (!c.name.trim()) err(`courses[${i}].name`, 'Nome do curso é obrigatório.');
    if (c.hours !== null && (c.hours < 0 || c.hours > 10000)) err(`courses[${i}].hours`, 'Carga horária inválida.');
  });

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

// ---------------------------------------------------------------------------
// Coerção estrutural: usada ao carregar do storage e ao importar JSON.
// Dados externos são tratados como não confiáveis: só campos conhecidos e tipos esperados são aceitos.
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 20) : null);
const bool = (v: unknown): boolean => v === true;
const strArr = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 500)).slice(0, max) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const oneOfOrNull = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const STATUSES: ValidationStatus[] = ['confirmed', 'extracted', 'ai_suggested', 'pending'];
const SOURCES: SourceKind[] = ['manual', 'resume_pdf', 'resume_docx', 'resume_text', 'certificate_file', 'linkedin_export', 'linkedin_page', 'json_import', 'ai'];
const EDU_LEVELS: EducationLevel[] = ['high_school', 'technical', 'associate', 'bachelor', 'postgraduate', 'master', 'doctorate', 'other'];
const LANG_LEVELS: LanguageLevel[] = ['basic', 'intermediate', 'advanced', 'fluent', 'native'];
const SKILL_CATS: SkillCategory[] = ['technical', 'tool', 'behavioral', 'methodology', 'domain'];

function coerceProvenance(v: unknown, now: string): Provenance {
  if (!isObj(v)) return { source: 'json_import', status: 'pending', updatedAt: now };
  const p: Provenance = {
    source: oneOf(v.source, SOURCES, 'json_import'),
    status: oneOf(v.status, STATUSES, 'pending'),
    updatedAt: str(v.updatedAt, 40) || now,
  };
  const snippet = str(v.sourceSnippet, 1000);
  if (snippet) p.sourceSnippet = snippet;
  return p;
}

function coerceList<T>(v: unknown, map: (o: Raw) => T, max = 300): T[] {
  return Array.isArray(v) ? v.filter(isObj).slice(0, max).map(map) : [];
}

const id = (v: unknown) => str(v, 100) || newId();

/** Converte dados desconhecidos num Profile válido estruturalmente. Lança erro se não for um objeto. */
export function coerceProfile(raw: unknown, now = new Date().toISOString()): Profile {
  if (!isObj(raw)) throw new Error('Formato de perfil inválido.');
  const base = createEmptyProfile(now);
  const per = isObj(raw.personal) ? raw.personal : {};
  const pref = isObj(raw.preferences) ? raw.preferences : {};
  const sum = isObj(raw.summary) ? raw.summary : {};
  const prov = (o: Raw) => coerceProvenance(o.provenance, now);

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    createdAt: str(raw.createdAt, 40) || base.createdAt,
    updatedAt: str(raw.updatedAt, 40) || base.updatedAt,
    personal: {
      fullName: str(per.fullName, 200),
      headline: str(per.headline, 300),
      email: str(per.email, 200),
      phone: str(per.phone, 50),
      city: str(per.city, 100),
      state: str(per.state, 100),
      country: str(per.country, 100),
      linkedinUrl: str(per.linkedinUrl, 500),
      githubUrl: str(per.githubUrl, 500),
      portfolioUrl: str(per.portfolioUrl, 500),
      provenance: coerceProvenance(per.provenance, now),
    },
    summary: { text: str(sum.text, 5000), provenance: coerceProvenance(sum.provenance, now) },
    experiences: coerceList(raw.experiences, (o) => ({
      id: id(o.id),
      title: str(o.title, 200),
      company: str(o.company, 200),
      location: str(o.location, 200),
      startDate: strOrNull(o.startDate),
      endDate: strOrNull(o.endDate),
      current: bool(o.current),
      description: str(o.description, 5000),
      achievements: strArr(o.achievements, 50),
      skills: strArr(o.skills, 100),
      provenance: prov(o),
    })),
    education: coerceList(raw.education, (o) => ({
      id: id(o.id),
      institution: str(o.institution, 200),
      degree: str(o.degree, 200),
      field: str(o.field, 200),
      level: oneOf(o.level, EDU_LEVELS, 'other'),
      status: oneOf(o.status, ['completed', 'in_progress', 'incomplete'] as const, 'completed'),
      startDate: strOrNull(o.startDate),
      endDate: strOrNull(o.endDate),
      provenance: prov(o),
    })),
    skills: coerceList(raw.skills, (o) => {
      const s = {
        id: id(o.id),
        name: str(o.name, 100),
        category: oneOf(o.category, SKILL_CATS, 'technical'),
        provenance: prov(o),
      } as Profile['skills'][number];
      const level = oneOfOrNull(o.level, ['basic', 'intermediate', 'advanced', 'expert'] as const);
      if (level) s.level = level;
      if (typeof o.yearsOfExperience === 'number' && Number.isFinite(o.yearsOfExperience)) s.yearsOfExperience = o.yearsOfExperience;
      return s;
    }),
    languages: coerceList(raw.languages, (o) => ({
      id: id(o.id),
      name: str(o.name, 100),
      level: oneOf(o.level, LANG_LEVELS, 'basic'),
      provenance: prov(o),
    })),
    certifications: coerceList(raw.certifications, (o) => ({
      id: id(o.id),
      name: str(o.name, 300),
      issuer: str(o.issuer, 200),
      issueDate: strOrNull(o.issueDate),
      expirationDate: strOrNull(o.expirationDate),
      credentialUrl: str(o.credentialUrl, 500),
      provenance: prov(o),
    })),
    courses: coerceList(raw.courses, (o) => ({
      id: id(o.id),
      name: str(o.name, 300),
      institution: str(o.institution, 200),
      hours: typeof o.hours === 'number' && Number.isFinite(o.hours) ? o.hours : null,
      completionDate: strOrNull(o.completionDate),
      provenance: prov(o),
    })),
    preferences: {
      workModes: strArr(pref.workModes).filter((m): m is 'remote' | 'hybrid' | 'onsite' => ['remote', 'hybrid', 'onsite'].includes(m)),
      preferredLocations: strArr(pref.preferredLocations, 20),
      willingToRelocate: typeof pref.willingToRelocate === 'boolean' ? pref.willingToRelocate : null,
      travelAvailability: oneOfOrNull(pref.travelAvailability, ['none', 'occasional', 'frequent'] as const),
      autonomy: oneOfOrNull(pref.autonomy, ['high', 'moderate', 'structured'] as const),
      collaboration: oneOfOrNull(pref.collaboration, ['collaborative', 'balanced', 'independent'] as const),
      schedule: oneOfOrNull(pref.schedule, ['flexible', 'fixed', 'shifts_ok'] as const),
      employmentTypes: strArr(pref.employmentTypes).filter((t): t is Profile['preferences']['employmentTypes'][number] =>
        ['clt', 'pj', 'internship', 'temporary', 'freelance'].includes(t),
      ),
      desiredSalary: str(pref.desiredSalary, 100),
      provenance: coerceProvenance(pref.provenance, now),
    },
  };
}
