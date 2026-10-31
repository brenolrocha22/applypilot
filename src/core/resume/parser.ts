import type {
  Certification,
  Course,
  Education,
  EducationStatus,
  Experience,
  LanguageSkill,
  PersonalInfo,
  Skill,
  SkillLevel,
  TravelAvailability,
  WorkMode,
  YearMonth,
} from '../model/profile';
import type { Provenance, SourceKind } from '../model/provenance';
import { detectEducationLevel } from '../knowledge/education';
import { detectLanguageLevel, findLanguages } from '../knowledge/languages';
import { foldPreserving, normalizeText } from '../knowledge/normalize';
import { findSkillMentions, getSkill, resolveSkillId } from '../knowledge/skills';
import { newId } from '../profile/factory';

/**
 * Extração heurística de currículo em texto → rascunho editável.
 * Nada aqui é gravado no perfil: o usuário revisa e escolhe o que importar (ver merge.ts).
 * Todos os itens recebem estado "extracted" (ou "pending" quando há dúvida) e o trecho de origem.
 */

export type PersonalField = Exclude<keyof PersonalInfo, 'provenance'>;

export interface DraftValue {
  value: string;
  snippet: string;
}

/** Preferências declaradas no próprio currículo (ex.: "Disponível para remoto, híbrido, viagens e mudança"). */
export interface PreferencesDraft {
  workModes?: WorkMode[];
  travelAvailability?: TravelAvailability;
  willingToRelocate?: boolean;
  snippet: string;
}

export interface ResumeDraft {
  source: SourceKind;
  personal: Partial<Record<PersonalField, DraftValue>>;
  summary: DraftValue | null;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  languages: LanguageSkill[];
  certifications: Certification[];
  courses: Course[];
  preferences: PreferencesDraft | null;
  warnings: string[];
}

type ResumeSection = 'summary' | 'experience' | 'education' | 'skills' | 'languages' | 'certifications' | 'courses' | 'other';

const HEADINGS: [ResumeSection, RegExp][] = [
  ['summary', /^(resumo( profissional)?|perfil( profissional)?|objetivos?( profissional)?|sobre mim|apresentacao|summary|professional summary|profile|about( me)?|objective)$/],
  ['experience', /^(experiencias?( profissional| profissionais)?|historico profissional|trajetoria profissional|experience|work experience|professional experience|employment( history)?)$/],
  ['education', /^(formacao( academica)?( e idiomas)?|escolaridade|educacao|education( and languages)?|academic background)$/],
  ['skills', /^(habilidades( tecnicas)?|competencias( tecnicas)?|conhecimentos( tecnicos)?|tecnologias|ferramentas|skills|technical skills|hard skills|tech stack)$/],
  ['languages', /^(idiomas|linguas|languages)$/],
  ['certifications', /^(certificacoes|certificados|certifications|licenses( (&|and) certifications)?)$/],
  ['courses', /^(cursos( complementares| livres)?|formacao complementar|courses|training|treinamentos)$/],
  ['other', /^(projetos|projects|voluntariado|volunteer\w*|premios|awards|interesses|interests|referencias|references|publicacoes|publications)$/],
];

const MONTHS: Record<string, number> = {
  jan: 1, janeiro: 1, january: 1,
  fev: 2, fevereiro: 2, feb: 2, february: 2,
  mar: 3, marco: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  mai: 5, maio: 5, may: 5,
  jun: 6, junho: 6, june: 6,
  jul: 7, julho: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, setembro: 9, sep: 9, sept: 9, september: 9,
  out: 10, outubro: 10, oct: 10, october: 10,
  nov: 11, novembro: 11, november: 11,
  dez: 12, dezembro: 12, dec: 12, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
// Anos restritos a 19xx/20xx para não confundir com números de telefone.
const YEAR = '(?:19|20)\\d{2}';
const DATE = `(?:(?:${MONTH_ALT})\\.?\\s*(?:de\\s*)?${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
const PRESENT = '(?:atual(?:mente)?|presente|present|current|o momento|hoje|now|em andamento)';
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|a|ate|to|until)\\s*(${DATE}|${PRESENT})`);

function parseDate(raw: string): YearMonth | null {
  const f = normalizeText(raw);
  let m = /^(\d{1,2})\/(\d{4})$/.exec(f);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = new RegExp(`^(${MONTH_ALT})\\.?\\s*(?:de\\s*)?(\\d{4})$`).exec(f);
  if (m) return `${m[2]}-${String(MONTHS[m[1]!]).padStart(2, '0')}`;
  m = /^(\d{4})$/.exec(f);
  return m ? m[1]! : null;
}

interface DateRange {
  start: YearMonth | null;
  end: YearMonth | null;
  current: boolean;
  /** Posição do intervalo na linha. */
  index: number;
  length: number;
}

export function findDateRange(line: string): DateRange | null {
  const m = RANGE_RE.exec(foldPreserving(line));
  if (!m) return null;
  const current = new RegExp(`^${PRESENT}$`).test(normalizeText(m[2]!));
  return { start: parseDate(m[1]!), end: current ? null : parseDate(m[2]!), current, index: m.index, length: m[0].length };
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}\b/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w%-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
const URL_RE = /(?:https?:\/\/)[^\s,;)]+/i;
const CITY_RE = /\b([A-ZÀ-Ú][a-zà-ú]+(?:\s(?:de|do|da|dos|das)?\s?[A-ZÀ-Ú][a-zà-ú]+)*)\s*[-,/]\s*([A-Z]{2})\b/;
const BULLET_RE = /^\s*(?:[-*•●▪◦·–—>]|\d{1,2}[.)])\s*/;
const COMPANY_HINT = /\b(ltda|s\.?a\.?|inc|corp|group|grupo|bank|banco|tecnologia|technologies|solucoes|solutions|consultoria|software|labs?)\b/i;
const INSTITUTION_HINT = /\b(universidade|faculdade|instituto|university|college|escola|fatec|etec|senai|senac|centro universitario|puc|usp|unicamp|ufrj|ufmg|unesp)\b/i;
const IN_PROGRESS_RE = /\b(em andamento|cursando|in progress|previsao|expected|trancado)\b/;

const ensureUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

function stripBullet(s: string): string {
  return s.replace(BULLET_RE, '').trim();
}

interface Block {
  section: ResumeSection;
  lines: string[];
}

/** Variantes sem espaços dos títulos, para layouts com letras espaçadas ("R E S U M O  P R O F I S S I O N A L"). */
const COMPACT_HEADINGS: [ResumeSection, RegExp][] = HEADINGS.map(([s, re]) => [s, new RegExp(re.source.replace(/ /g, ''))]);

function isLetterSpaced(clean: string): boolean {
  const tokens = clean.split(' ');
  return tokens.length >= 4 && tokens.filter((t) => t.length === 1).length / tokens.length >= 0.7;
}

function detectHeading(line: string): ResumeSection | null {
  const clean = normalizeText(line.replace(/[:#*_]+/g, ' '));
  if (isLetterSpaced(clean)) {
    const compact = clean.replace(/\s+/g, '');
    return compact.length <= 45 ? (COMPACT_HEADINGS.find(([, re]) => re.test(compact))?.[0] ?? null) : null;
  }
  return clean.length <= 45 ? (HEADINGS.find(([, re]) => re.test(clean))?.[0] ?? null) : null;
}

function splitSections(lines: string[]): { header: string[]; blocks: Block[] } {
  const header: string[] = [];
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of lines) {
    const section = detectHeading(line);
    if (section) {
      const block: Block = { section, lines: [] };
      current = block;
      blocks.push(block);
    } else if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  return { header, blocks };
}


const PAGE_FOOTER_RE = /(p[aá]gina|page)\s+\d+\s+(de|of)\s+\d+/i;
const TERMINAL_PUNCT_RE = /[.;:!?]$/;

/**
 * Junta linhas quebradas pelo layout do PDF à linha anterior:
 * começa com minúscula/dígito, ou a anterior é longa e não termina com pontuação.
 * Linhas com intervalo de datas nunca são juntadas (costumam iniciar um novo item).
 */
export function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const t = line.trim();
    const continuation =
      prev !== undefined &&
      !BULLET_RE.test(line) &&
      !findDateRange(t) &&
      // Maiúscula só continua a linha anterior se ela foi cortada no meio da frase (termina em minúscula ou vírgula).
      (/^[\p{Ll}\d(]/u.test(t) || (prev.trim().length >= 70 && !TERMINAL_PUNCT_RE.test(prev.trim()) && /[\p{Ll},]$/u.test(prev.trim())));
    if (continuation) out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${t}`;
    else out.push(line);
  }
  return out;
}

const LEVEL_SUFFIX: [RegExp, SkillLevel][] = [
  [/\s+(basico|basic|fundamentos)$/, 'basic'],
  [/\s+(intermediario|intermediate)$/, 'intermediate'],
  [/\s+(avancado|advanced)$/, 'advanced'],
];

/** Data única: "08/2019", "out. 2026", "março de 2024", "2023" (a última ocorrência no texto). */
export function parseSingleDate(text: string): YearMonth | null {
  const f = normalizeText(text);
  const candidates: { idx: number; value: YearMonth }[] = [];
  for (const m of f.matchAll(new RegExp(`\\b(${MONTH_ALT})\\.?\\s*(?:de\\s*)?((?:19|20)\\d{2})\\b`, 'g'))) {
    candidates.push({ idx: m.index!, value: `${m[2]}-${String(MONTHS[m[1]!]).padStart(2, '0')}` });
  }
  for (const m of f.matchAll(/\b(\d{1,2})\/((?:19|20)\d{2})\b/g)) {
    if (Number(m[1]) >= 1 && Number(m[1]) <= 12) candidates.push({ idx: m.index!, value: `${m[2]}-${m[1]!.padStart(2, '0')}` });
  }
  if (!candidates.length) {
    for (const m of f.matchAll(/\b((?:19|20)\d{2})\b/g)) candidates.push({ idx: m.index!, value: m[1]! });
  }
  return candidates.sort((a, b) => a.idx - b.idx).pop()?.value ?? null;
}

const MODE_WORDS: [RegExp, WorkMode][] = [
  [/\bremot[oa]s?\b|\bremote\b|home office/, 'remote'],
  [/\bhibrid[oa]s?\b|\bhybrid\b/, 'hybrid'],
  [/\bpresencial\b|\bon-?site\b/, 'onsite'],
];

function parsePreferences(lines: string[]): PreferencesDraft | null {
  for (const line of lines) {
    const f = normalizeText(line);
    const m = /(?:disponivel|disponibilidade|aberto|available|open)\s+(?:para|a|to|for)\s+(.+)/.exec(f);
    if (!m) continue;
    const segment = m[1]!.split(/[·|•]/)[0]!;
    const draft: PreferencesDraft = { snippet: line.trim() };
    const modes = MODE_WORDS.filter(([re]) => re.test(segment)).map(([, mode]) => mode);
    if (modes.length) draft.workModes = modes;
    if (/\bviage(m|ns)\b|\btravel/.test(segment)) draft.travelAvailability = 'occasional';
    if (/\bmudanca\b|\brelocat/.test(segment)) draft.willingToRelocate = true;
    if (draft.workModes || draft.travelAvailability || draft.willingToRelocate) return draft;
  }
  return null;
}

export function parseResumeText(text: string, source: SourceKind, now = new Date().toISOString()): ResumeDraft {
  const prov = (snippet: string, status: Provenance['status'] = 'extracted'): Provenance => ({
    source,
    status,
    sourceSnippet: clip(snippet.trim()),
    updatedAt: now,
  });
  const warnings: string[] = [];
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0 && !PAGE_FOOTER_RE.test(l));

  const { header, blocks } = splitSections(lines);
  // Em competências e idiomas cada linha costuma ser uma categoria: não junta.
  for (const b of blocks) if (b.section !== 'skills' && b.section !== 'languages') b.lines = joinWrappedLines(b.lines);
  const sectionLines = (s: ResumeSection) => blocks.filter((b) => b.section === s).flatMap((b) => b.lines);
  if (!blocks.length) warnings.push('Nenhuma seção padrão (Experiência, Formação, Habilidades…) foi reconhecida. Revise os dados com atenção.');

  // ---- Dados pessoais (procura no cabeçalho e, se preciso, no texto inteiro)
  const personal: ResumeDraft['personal'] = {};
  const headText = header.join('\n');
  const findIn = (re: RegExp): DraftValue | undefined => {
    for (const src of [headText, text]) {
      const m = re.exec(src);
      if (m) return { value: m[0].trim(), snippet: m[0].trim() };
    }
    return undefined;
  };
  const email = findIn(EMAIL_RE);
  if (email) personal.email = email;
  const linkedin = findIn(LINKEDIN_RE);
  if (linkedin) personal.linkedinUrl = { ...linkedin, value: ensureUrl(linkedin.value) };
  const github = findIn(GITHUB_RE);
  if (github) personal.githubUrl = { ...github, value: ensureUrl(github.value) };
  const textWithoutKnownUrls = text.replace(LINKEDIN_RE, '').replace(GITHUB_RE, '');
  const portfolio = URL_RE.exec(textWithoutKnownUrls);
  if (portfolio) personal.portfolioUrl = { value: portfolio[0], snippet: portfolio[0] };
  const phone = PHONE_RE.exec(headText || text);
  if (phone) personal.phone = { value: phone[0].trim(), snippet: phone[0].trim() };

  const nameLine = (header.length ? header : lines).slice(0, 5).find((l) => {
    const t = l.trim();
    const words = t.split(/\s+/);
    return words.length >= 2 && words.length <= 6 && /^[\p{L}\s.'-]+$/u.test(t) && t.length <= 60;
  });
  if (nameLine) {
    personal.fullName = { value: nameLine.trim(), snippet: nameLine.trim() };
    const idx = lines.indexOf(nameLine);
    const next = lines[idx + 1]?.trim();
    if (next && next.length <= 100 && !EMAIL_RE.test(next) && !PHONE_RE.test(next) && !URL_RE.test(next) && !CITY_RE.test(next) && header.includes(lines[idx + 1]!)) {
      personal.headline = { value: next, snippet: next };
    }
  } else {
    warnings.push('Nome não identificado.');
  }
  const city = CITY_RE.exec(headText);
  if (city) {
    personal.city = { value: city[1]!, snippet: city[0] };
    personal.state = { value: city[2]!, snippet: city[0] };
  }

  // ---- Resumo
  const summaryLines = sectionLines('summary');
  const summary = summaryLines.length ? { value: summaryLines.map((l) => l.trim()).join(' '), snippet: clip(summaryLines.join('\n')) } : null;

  // ---- Competências
  const skills: Skill[] = [];
  const seenSkill = new Set<string>();
  const addSkill = (rawName: string, snippet: string) => {
    let clean = rawName.replace(/[.:;]+$/, '').replace(/\s+/g, ' ').trim();
    let level: SkillLevel | undefined;
    for (const [re, lv] of LEVEL_SUFFIX) {
      const folded = normalizeText(clean);
      const m = re.exec(folded);
      if (m && folded.length > m[0].length) {
        clean = clean.slice(0, clean.length - m[0].length).trim();
        level = lv;
      }
    }
    if (clean.length < 2 || clean.length > 40 || /^\d+$/.test(clean) || clean.split(' ').length > 4 || /\b(e|de|com|and|of)$/i.test(clean)) return;
    const key = resolveSkillId(clean) ?? normalizeText(clean);
    if (seenSkill.has(key)) return;
    seenSkill.add(key);
    const def = getSkill(resolveSkillId(clean) ?? '');
    const skill: Skill = { id: newId(), name: def?.name ?? clean, category: def?.category ?? 'technical', provenance: prov(snippet) };
    if (level) skill.level = level;
    skills.push(skill);
  };
  for (const line of sectionLines('skills')) {
    // Remove detalhes entre parênteses e um rótulo de categoria "Front-end: ..."
    let content = stripBullet(line).replace(/\([^)]*\)/g, '').replace(/^[^:,]{1,30}:\s*/, '');
    // O trecho antes da 1ª vírgula costuma trazer o rótulo da categoria colado ("Dados e BI Excel avançado"):
    // se tiver 3+ palavras, aproveita só as competências conhecidas dele.
    const comma = content.indexOf(',');
    const head = comma < 0 ? content : content.slice(0, comma);
    const headMentions = head.trim().split(/\s+/).length >= 3 ? findSkillMentions(head) : [];
    if (headMentions.length) {
      content = headMentions.map((m) => getSkill(m.skillId)?.name ?? m.alias).join(', ') + (comma < 0 ? '' : content.slice(comma));
    }
    for (const part of content.split(/[,;|•·/]| e (?=[A-ZÀ-Ú])/)) addSkill(part, line);
  }
  for (const m of findSkillMentions(text)) {
    const def = getSkill(m.skillId);
    if (def) addSkill(def.name, text.slice(Math.max(0, m.start - 40), m.end + 40));
  }

  // ---- Experiências
  const experiences = parseExperiences(sectionLines('experience'), prov, warnings);
  if (!experiences.length && sectionLines('experience').length) warnings.push('A seção de experiência foi encontrada, mas nenhum período (datas) foi identificado.');

  // ---- Formação
  const education = parseEducation(sectionLines('education'), prov);

  // ---- Idiomas
  const languages: LanguageSkill[] = [];
  const langCandidates = sectionLines('languages').length ? sectionLines('languages') : lines.filter((l) => findLanguages(l).length && detectLanguageLevel(l));
  for (const line of langCandidates) {
    // "Inglês avançado, Espanhol básico" → avalia cada trecho separadamente
    for (const part of line.split(/[,;|•·]/)) {
      for (const lang of findLanguages(part)) {
        if (languages.some((l) => normalizeText(l.name) === normalizeText(lang.name))) continue;
        const level = detectLanguageLevel(part);
        languages.push({ id: newId(), name: lang.name, level: level ?? 'basic', provenance: prov(line, level ? 'extracted' : 'pending') });
        if (!level) warnings.push(`Nível de ${lang.name} não identificado: marcado como "Básico" e pendente de confirmação.`);
      }
    }
  }

  // ---- Certificações e cursos
  const certifications: Certification[] = sectionLines('certifications').map((line) => {
    const item = parseListItem(line);
    return {
      id: newId(),
      name: item.name,
      issuer: item.institution,
      issueDate: item.date,
      expirationDate: null,
      credentialUrl: URL_RE.exec(line)?.[0] ?? '',
      provenance: prov(line),
    };
  });
  const courses: Course[] = sectionLines('courses').flatMap((line) => {
    // "Outras: Curso A (6 h, 2022) · Curso B (Emissor, 2024)" → um item por trecho
    const summary = /^\s*(outr[oa]s|others?)\s*:\s*/i.exec(stripBullet(line));
    const items = summary ? stripBullet(line).slice(summary[0].length).split(/\s·\s/) : [line];
    return items.map((it) => {
      const item = parseListItem(it);
      return { id: newId(), name: item.name, institution: item.institution, hours: item.hours, completionDate: item.date, provenance: prov(line) };
    });
  });

  const preferences = parsePreferences(header.length ? header : lines.slice(0, 8));

  return { source, personal, summary, experiences, education, skills, languages, certifications, courses, preferences, warnings };
}

const HOURS_RE = /\(?\b(\d{1,4})\s*h(?:oras|rs?)?\b\)?/i;

/** Item de lista de curso/certificação: "Nome · Instituição, 29 h, out. 2026 — detalhes" ou "Nome - Instituição (2023)". */
function parseListItem(line: string): { name: string; institution: string; hours: number | null; date: YearMonth | null } {
  const clean = stripBullet(line);
  const hours = HOURS_RE.exec(clean);
  const strip = (s: string) =>
    s
      .replace(HOURS_RE, '')
      .replace(/\(?\b(19|20)\d{2}\b\)?/g, '')
      .replace(/\(\s*,?\s*\)/g, '')
      .replace(/[\s,·–—-]+$/, '')
      .trim();
  // Separador principal: "·" ou "|"; sem eles, travessão/hífen entre espaços.
  const parts = /\s[·|]\s/.test(clean) ? clean.split(/\s[·|]\s/) : clean.split(/\s[-–—]\s/);
  // A data do 2º trecho (emissor) tem prioridade: o item pode citar outros cursos depois.
  const date = parseSingleDate(parts.slice(0, 2).join(' ')) ?? parseSingleDate(clean);
  // "Nome — detalhes em minúsculas" → remove os detalhes; "Bootcamp X — Dados e IA" (maiúscula) faz parte do nome.
  // "(Emissor, 2024)" no fim do item
  const trailing = /\(([^,()]{2,60}),\s*(?:19|20)\d{2}\)\s*$/.exec(parts[0] ?? '');
  const name = strip((parts[0] ?? clean).replace(trailing?.[0] ?? '', '').replace(/\s[—–]\s\p{Ll}.*$/u, ''));
  const institution = strip((parts[1] ?? '').split(/,|\s[-–—]\s/)[0] ?? '') || (trailing && !/^\d{1,4}\s*h/i.test(trailing[1]!.trim()) ? trailing[1]!.trim() : '');
  return { name: name || strip(clean), institution, hours: hours ? Number(hours[1]) : null, date };
}

/** Local colado ao fim do nome da empresa: modalidade ou "Cidade/UF" (cidades compostas só com prefixos comuns). */
const TRAILING_LOCATION_RE =
  /\s+((?:Remoto|Remote|H[íi]brido|Hybrid|Presencial)|(?:(?:S[ãa]o|Rio|Belo|Porto|Campo|Santa|Santo|Juiz|Feira|Ribeir[ãa]o|Foz|Nova|Vila|Praia|Jaboat[ãa]o|Cabo)\s(?:de\s|do\s|da\s|dos\s|das\s)?)?[\p{Lu}][\p{L}]+\/[A-Z]{2})$/u;
/** Linhas-resumo como "Anteriores: Recepcionista, Hotel X (2014–2015) · …" não são uma experiência única. */
const SUMMARY_EXPERIENCE_LINE = /^\s*(anteriores|outras experiencias|outras|previous|other experience)\s*:/;

function parseExperiences(allLines: string[], prov: (s: string) => Provenance, warnings: string[] = []): Experience[] {
  const lines = allLines.filter((l) => {
    const skip = SUMMARY_EXPERIENCE_LINE.test(normalizeText(stripBullet(l)));
    if (skip) warnings.push(`Linha com várias experiências resumidas não foi importada (cadastre manualmente se quiser): "${clip(l.trim(), 120)}"`);
    return !skip;
  });
  const dateIdx = lines.map((l, i) => (findDateRange(l) ? i : -1)).filter((i) => i >= 0);
  const out: Experience[] = [];
  let consumedUntil = -1;
  const headerStartFor = (di: number, floor: number): number => {
    const range = findDateRange(lines[di]!)!;
    const rest = lines[di]!.slice(0, range.index) + lines[di]!.slice(range.index + range.length);
    // Linha com cargo/empresa e datas juntos: não usa linhas anteriores.
    if (rest.replace(/[\s()|,·–—-]/g, '').length >= 3) return di;
    let start = di;
    while (start - 1 > floor && di - (start - 1) <= 2) {
      const prev = lines[start - 1]!;
      if (BULLET_RE.test(prev) || prev.trim().length > 80) break;
      start--;
    }
    return start;
  };
  dateIdx.forEach((di, k) => {
    const headerStart = headerStartFor(di, consumedUntil);
    const nextDate = dateIdx[k + 1];
    const end = nextDate !== undefined ? headerStartFor(nextDate, di) : lines.length;
    const range = findDateRange(lines[di]!)!;
    const dateLine = lines[di]!;
    const dateLineRest = (dateLine.slice(0, range.index) + dateLine.slice(range.index + range.length)).replace(/[()|,·–—-]+\s*$/, '').replace(/^\s*[()|,·–—-]+/, '').trim();
    const headerParts = [...lines.slice(headerStart, di).map((l) => l.trim()), dateLineRest]
      .flatMap((h) => h.split(/\s+(?:\||·|•|@|—|–|-|at|na|no)\s+/))
      .map((h) => h.replace(/[()]/g, '').trim())
      .filter(Boolean);
    let title = headerParts[0] ?? '';
    let company = headerParts[1] ?? '';
    const locationParts = headerParts.slice(2);
    if (COMPANY_HINT.test(title) && !COMPANY_HINT.test(company)) [title, company] = [company, title];
    // "Empresa X Remoto" / "Empresa Y Recife/PE": separa o local colado ao nome da empresa.
    const trailing = TRAILING_LOCATION_RE.exec(company);
    if (trailing && trailing.index > 0) {
      locationParts.unshift(trailing[1]!);
      company = company.slice(0, trailing.index).trim();
    }
    const bodyLines = lines.slice(di + 1, end);
    const achievements = bodyLines.filter((l) => BULLET_RE.test(l)).map(stripBullet);
    const description = bodyLines.filter((l) => !BULLET_RE.test(l)).map((l) => l.trim()).join(' ');
    const blockText = lines.slice(headerStart, end).join('\n');
    out.push({
      id: newId(),
      title,
      company,
      location: locationParts.join(' · '),
      startDate: range.start,
      endDate: range.end,
      current: range.current,
      description,
      achievements,
      skills: findSkillMentions(blockText).map((m) => getSkill(m.skillId)?.name ?? m.alias),
      provenance: prov(blockText),
    });
    consumedUntil = end - 1;
  });
  return out;
}

function parseEducation(lines: string[], prov: (s: string) => Provenance): Education[] {
  const out: Education[] = [];
  let current: { edu: Education; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      current.edu.provenance = prov(current.lines.join('\n'));
      out.push(current.edu);
    }
    current = null;
  };
  for (const raw of lines) {
    const line = stripBullet(raw);
    const level = detectEducationLevel(line);
    // Linhas de idiomas dentro de "Formação e idiomas" não são formação.
    if (!level && findLanguages(line).length && detectLanguageLevel(line)) continue;
    const isInstitution = INSTITUTION_HINT.test(normalizeText(line));
    const range = findDateRange(line);
    const startsNew = level !== null && (!current || current.edu.degree !== '');
    if (startsNew || (!current && isInstitution)) {
      flush();
      current = {
        edu: { id: newId(), institution: '', degree: '', field: '', level: level ?? 'other', status: 'completed', startDate: null, endDate: null, provenance: prov(line) },
        lines: [],
      };
    }
    if (!current) continue;
    const c: { edu: Education; lines: string[] } = current;
    c.lines.push(raw);
    const textWithoutDates = (range ? line.slice(0, range.index) + line.slice(range.index + range.length) : line).replace(/\(?\b(19|20)\d{2}\b\)?/g, '').trim();
    const parts = textWithoutDates.split(/\s[-–—|·]\s|\s,\s/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (/^(conclu|em andamento|cursando|previs|in progress|expected|graduated)/i.test(normalizeText(p))) continue;
      if (INSTITUTION_HINT.test(normalizeText(p)) && !c.edu.institution) {
        c.edu.institution = p.replace(/,\s*[\p{L} ]+\/[A-Z]{2}$/u, '').trim();
      } else if (!c.edu.degree && (detectEducationLevel(p) || !INSTITUTION_HINT.test(normalizeText(p)))) {
        c.edu.degree = p;
        const fieldMatch = /\b(?:em|in|de)\s+(.+)$/i.exec(p);
        if (fieldMatch && detectEducationLevel(p)) c.edu.field = fieldMatch[1]!.trim();
      }
    }
    if (level && c.edu.level === 'other') c.edu.level = level;
    if (range) {
      c.edu.startDate = range.start;
      c.edu.endDate = range.end;
      if (range.current) c.edu.status = 'in_progress';
    } else if (!c.edu.endDate) {
      c.edu.endDate = parseSingleDate(line);
    }
    if (IN_PROGRESS_RE.test(normalizeText(line))) c.edu.status = 'in_progress' as EducationStatus;
  }
  flush();
  return out;
}
