import type { Certification, Course, Education, Experience, LanguageLevel, LanguageSkill, Skill } from '../model/profile';
import type { Provenance } from '../model/provenance';
import { detectEducationLevel } from '../knowledge/education';
import { normalizeText } from '../knowledge/normalize';
import { getSkill, resolveSkillId } from '../knowledge/skills';
import { newId } from '../profile/factory';
import { parseSingleDate, type DraftValue, type ResumeDraft } from '../resume/parser';

/**
 * Leitura da exportação oficial de dados do LinkedIn ("Obter uma cópia dos seus dados"):
 * um .zip com arquivos CSV (Profile.csv, Positions.csv, Education.csv, Skills.csv…).
 * É o caminho permitido pelo LinkedIn — não há leitura automática do site.
 * O resultado é um rascunho revisável, igual ao da importação de currículo.
 */

/** CSV (RFC 4180): aspas, vírgulas e quebras de linha dentro de campos, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Converte em registros a partir da linha de cabeçalho que contém `requiredColumn` (alguns CSVs têm notas antes). */
export function csvRecords(text: string, requiredColumn: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === requiredColumn.toLowerCase()));
  if (headerIdx < 0) return [];
  const header = rows[headerIdx]!.map((h) => h.trim());
  return rows.slice(headerIdx + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const LEVELS: [RegExp, LanguageLevel][] = [
  [/(native|bilingual|nativ|bilingue)/, 'native'],
  [/(full professional|profissional completa|fluente|fluent)/, 'fluent'],
  // "limitada" antes de "profissional": "Proficiência profissional limitada" é intermediário.
  [/(limited working|limitada)/, 'intermediate'],
  [/(professional working|proficiencia profissional|profissional de trabalho)/, 'advanced'],
  [/(elementary|elementar|basic|basico)/, 'basic'],
];

function languageLevel(raw: string): LanguageLevel | null {
  const f = normalizeText(raw);
  for (const [re, level] of LEVELS) if (re.test(f)) return level;
  return null;
}

/** Nomes de arquivo dentro do zip são comparados sem diretório e sem diferenciar maiúsculas. */
function pick(files: Record<string, string>, name: string): string | null {
  const key = Object.keys(files).find((k) => k.split('/').pop()!.toLowerCase() === name.toLowerCase());
  return key ? files[key]! : null;
}

export function isLinkedInExport(fileNames: string[]): boolean {
  const names = fileNames.map((n) => n.split('/').pop()!.toLowerCase());
  return names.includes('profile.csv') && (names.includes('positions.csv') || names.includes('education.csv') || names.includes('skills.csv'));
}

export function linkedInExportToDraft(files: Record<string, string>, now = new Date().toISOString()): ResumeDraft {
  const warnings: string[] = [];
  const prov = (file: string, detail: string): Provenance => ({
    source: 'linkedin_export',
    status: 'extracted',
    sourceSnippet: `LinkedIn (${file}): ${detail}`.slice(0, 300),
    updatedAt: now,
  });
  const dv = (value: string, file: string): DraftValue => ({ value: value.trim(), snippet: `LinkedIn (${file})` });

  // ---- Perfil
  const personal: ResumeDraft['personal'] = {};
  let summary: DraftValue | null = null;
  const profileCsv = pick(files, 'Profile.csv');
  const profile = profileCsv ? csvRecords(profileCsv, 'First Name')[0] : undefined;
  if (profile) {
    const name = [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ');
    if (name) personal.fullName = dv(name, 'Profile.csv');
    if (profile['Headline']) personal.headline = dv(profile['Headline'], 'Profile.csv');
    if (profile['Summary']) summary = { value: profile['Summary'].replace(/\s+\n/g, '\n').trim(), snippet: 'LinkedIn (Profile.csv): Summary' };
    // "Recife, Pernambuco, Brazil" / "Recife e Região"
    const geo = (profile['Geo Location'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    if (geo[0]) personal.city = dv(geo[0].replace(/\s+e regi[aã]o$/i, '').replace(/\s+area$/i, ''), 'Profile.csv');
    if (geo.length >= 3 && geo[1]) personal.state = dv(geo[1], 'Profile.csv');
    if (geo.length >= 2) personal.country = dv(geo[geo.length - 1]!, 'Profile.csv');
    for (const url of (profile['Websites'] ?? '').match(/https?:\/\/[^\s,\]]+/g) ?? []) {
      if (/github\.com/i.test(url)) personal.githubUrl ??= dv(url, 'Profile.csv');
      else personal.portfolioUrl ??= dv(url, 'Profile.csv');
    }
    // Data de nascimento e endereço completo não são importados (desnecessários e sensíveis).
  } else {
    warnings.push('Profile.csv não encontrado no arquivo: dados pessoais e resumo não importados.');
  }

  const emails = csvRecords(pick(files, 'Email Addresses.csv') ?? '', 'Email Address');
  const email = emails.find((e) => /^yes$/i.test(e['Primary'] ?? '')) ?? emails[0];
  if (email?.['Email Address']) personal.email = dv(email['Email Address'], 'Email Addresses.csv');
  const phone = csvRecords(pick(files, 'PhoneNumbers.csv') ?? '', 'Number')[0];
  if (phone?.['Number']) personal.phone = dv(phone['Number'], 'PhoneNumbers.csv');

  // ---- Cargos
  const experiences: Experience[] = csvRecords(pick(files, 'Positions.csv') ?? '', 'Company Name').map((p) => {
    const finished = p['Finished On'] ?? '';
    const description = p['Description'] ?? '';
    const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => /^[-•▪*·]/.test(l)).map((l) => l.replace(/^[-•▪*·]\s*/, ''));
    return {
      id: newId(),
      title: p['Title'] ?? '',
      company: p['Company Name'] ?? '',
      location: p['Location'] ?? '',
      startDate: parseSingleDate(p['Started On'] ?? ''),
      endDate: finished ? parseSingleDate(finished) : null,
      current: !finished,
      description: lines.filter((l) => !/^[-•▪*·]/.test(l)).join(' '),
      achievements: bullets,
      skills: [],
      provenance: prov('Positions.csv', `${p['Title']} — ${p['Company Name']}`),
    };
  });

  // ---- Formação
  const education: Education[] = csvRecords(pick(files, 'Education.csv') ?? '', 'School Name').map((e) => {
    const degree = e['Degree Name'] ?? '';
    const end = e['End Date'] ? parseSingleDate(e['End Date']) : null;
    const inProgress = end !== null && Number(end.slice(0, 4)) > new Date(now).getUTCFullYear();
    return {
      id: newId(),
      institution: e['School Name'] ?? '',
      degree,
      field: degree.split(/,|\sem\s|\sin\s/i)[1]?.trim() ?? '',
      level: detectEducationLevel(degree) ?? 'other',
      status: inProgress ? 'in_progress' : 'completed',
      startDate: e['Start Date'] ? parseSingleDate(e['Start Date']) : null,
      endDate: end,
      provenance: prov('Education.csv', `${degree} — ${e['School Name']}`),
    };
  });
  if (education.some((e) => e.level === 'other')) warnings.push('Alguma formação do LinkedIn não teve o nível identificado (ex.: bacharelado, MBA). Ajuste no perfil.');

  // ---- Competências
  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const s of csvRecords(pick(files, 'Skills.csv') ?? '', 'Name')) {
    const name = s['Name'] ?? '';
    const key = resolveSkillId(name) ?? normalizeText(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const def = getSkill(resolveSkillId(name) ?? '');
    skills.push({ id: newId(), name, category: def?.category ?? 'technical', provenance: prov('Skills.csv', name) });
  }

  // ---- Idiomas
  const languages: LanguageSkill[] = csvRecords(pick(files, 'Languages.csv') ?? '', 'Name')
    .filter((l) => l['Name'])
    .map((l) => {
      const level = languageLevel(l['Proficiency'] ?? '');
      if (!level) warnings.push(`Nível de ${l['Name']} não informado no LinkedIn: marcado como "Básico" e pendente de confirmação.`);
      return {
        id: newId(),
        name: l['Name']!,
        level: level ?? 'basic',
        provenance: { ...prov('Languages.csv', `${l['Name']}: ${l['Proficiency'] || 'sem nível'}`), status: level ? 'extracted' : 'pending' },
      };
    });

  // ---- Certificações e cursos
  const certifications: Certification[] = csvRecords(pick(files, 'Certifications.csv') ?? '', 'Name')
    .filter((c) => c['Name'])
    .map((c) => ({
      id: newId(),
      name: c['Name']!,
      issuer: c['Authority'] ?? '',
      issueDate: c['Started On'] ? parseSingleDate(c['Started On']) : null,
      expirationDate: c['Finished On'] ? parseSingleDate(c['Finished On']) : null,
      credentialUrl: /^https?:\/\//i.test(c['Url'] ?? '') ? c['Url']! : '',
      provenance: prov('Certifications.csv', `${c['Name']} — ${c['Authority'] ?? ''}`),
    }));
  const courses: Course[] = csvRecords(pick(files, 'Courses.csv') ?? '', 'Name')
    .filter((c) => c['Name'])
    .map((c) => ({ id: newId(), name: c['Name']!, institution: '', hours: null, completionDate: null, provenance: prov('Courses.csv', c['Name']!) }));

  if (!experiences.length && !education.length && !skills.length) {
    warnings.push('Nenhum cargo, formação ou competência encontrado. Na exportação do LinkedIn, inclua "Perfil", "Cargos", "Formação acadêmica" e "Competências" (ou "Quero tudo").');
  }

  return { source: 'linkedin_export', personal, summary, experiences, education, skills, languages, certifications, courses, preferences: null, warnings };
}
