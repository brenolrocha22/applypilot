import type { Certification, Course, Education, EducationLevel, Profile, YearMonth } from '../model/profile';
import type { Provenance, SourceKind, ValidationStatus } from '../model/provenance';
import { foldPreserving, meaningfulTokens, normalizeText } from '../knowledge/normalize';
import { EDUCATION_LEVEL_LABELS } from '../knowledge/education';
import { newId } from '../profile/factory';

/**
 * Leitura de certificados e diplomas → rascunhos revisáveis.
 * Fontes, em ordem de confiança: texto do documento ("extraído") e, quando não há texto
 * (certificado em imagem), o nome do arquivo e da pasta ("pendente de confirmação").
 * Nada entra no perfil sem seleção do usuário.
 */

export type CertificateKind = 'certification' | 'course' | 'degree';

export interface CertificateDraft {
  id: string;
  /** Caminho relativo do arquivo (ex.: "Cursos/HTML e CSS.pdf"). */
  filePath: string;
  kind: CertificateKind;
  name: string;
  issuer: string;
  date: YearMonth | null;
  hours: number | null;
  credentialUrl: string;
  /** Somente para diplomas. */
  educationLevel: EducationLevel | null;
  /** Nome da pessoa a quem o documento foi emitido, se identificado. */
  holderName: string;
  /** De onde vieram os dados. */
  basis: 'text' | 'file_name';
  /** Trecho de origem já sem números de documentos e datas de nascimento. */
  snippet: string;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  janeiro: 1, january: 1, jan: 1, fevereiro: 2, february: 2, fev: 2, feb: 2, marco: 3, march: 3, mar: 3,
  abril: 4, april: 4, abr: 4, apr: 4, maio: 5, may: 5, mai: 5, junho: 6, june: 6, jun: 6, julho: 7, july: 7, jul: 7,
  agosto: 8, august: 8, ago: 8, aug: 8, setembro: 9, september: 9, set: 9, sep: 9, outubro: 10, october: 10, out: 10, oct: 10,
  novembro: 11, november: 11, nov: 11, dezembro: 12, december: 12, dez: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Plataformas e emissores frequentes (testados contra texto e caminho do arquivo, já normalizados). */
const KNOWN_ISSUERS: [RegExp, string][] = [
  [/\budemy\b|ude\.my/, 'Udemy'],
  [/\bcoursera\b/, 'Coursera'],
  [/\balura\b/, 'Alura'],
  [/\bdio\b|digital innovation one|\bdio\.me\b/, 'DIO'],
  [/\brocketseat\b/, 'Rocketseat'],
  [/\bprime cursos\b/, 'Prime Cursos'],
  [/\bestacio\b/, 'Estácio'],
  [/\bfarma trainer\b/, 'Farma Trainer'],
  [/\bviscari\b/, 'Viscari'],
  [/\bfundacao bradesco\b/, 'Fundação Bradesco'],
  [/\bfiap\b/, 'FIAP'],
  [/\bsenai\b/, 'SENAI'],
  [/\bsenac\b/, 'SENAC'],
  [/\bsebrae\b/, 'SEBRAE'],
  [/\bescola virtual\b/, 'Escola Virtual Gov'],
  [/\blinkedin learning\b/, 'LinkedIn Learning'],
  [/\bamazon web services\b|\baws certified\b/, 'Amazon Web Services'],
  [/\bmicrosoft certified\b|\bmicrosoft learn\b/, 'Microsoft'],
  [/\bgoogle career certificates?\b|\bgoogle cloud certified\b/, 'Google'],
  [/\boracle certified\b/, 'Oracle'],
  [/\bcisco\b/, 'Cisco'],
  [/\bscrum\.org\b/, 'Scrum.org'],
  [/\bscrum alliance\b/, 'Scrum Alliance'],
  [/project management institute/, 'PMI'],
  [/\bedx\b/, 'edX'],
  [/\bfgv\b|fundacao getulio vargas/, 'FGV'],
];

const CERTIFICATION_HINT = /\b(certification|certified|certificacao|credencial|credential|badge|exam|exame|practitioner|fundamentals)\b/;
const DEGREE_HINT = /\b(diploma|colacao de grau|confere o titulo|outorga-lhe|grau de (bacharel|licenciad|tecnolog|mestre|doutor))\b/;
/** Âncoras que indicam o início de um certificado numa página. */
const ANCHOR_RE = /(certificamos que|certifica que|concluiu|participou d|completou|has (successfully )?completed|this is to certify|certificate of (completion|achievement)|^\s*curso (de|livre)\b|confere o titulo|diploma)/m;
const URL_RE = /\b(?:https?:\/\/|www\.|ude\.my\/|coursera\.org\/|credly\.com\/)[^\s,;)"'<>]+/i;

const NAME_PATTERNS: RegExp[] = [
  // "concluiu o curso de HTML e CSS com carga…" / "concluiu o curso X\n(3 horas)" / "Participou do curso X, ministrado…"
  /(?:concluiu|concluiu com (?:exito|aproveitamento)|participou d[oa]|completou|finalizou)\s+(?:o|a)?\s*(?:curso|treinamento|formacao|trilha|bootcamp|minicurso)?\s*(?:de|em|:)?\s*["“]?([^"”(]{3,160}?)["”]?(?=\s*(?:\(|,|\.|com carga|com duracao|realizad|ministrad|no periodo|\sem \d|\n\s*\n|$))/,
  /(?:has (?:successfully )?completed|successfully completed|completed)\s+(?:the\s+)?(?:course\s+|online course\s+)?["“]?([^\n"”]{3,120}?)["”]?(?=\s*(?:,|\.|\n|on |an online|$))/,
  // Prime Cursos: "Curso de Venda em 10 Passos" numa linha própria
  /^\s*curso (?:de |livre de )?([^\n]{3,120})$/m,
  /\b((?:aws|microsoft|azure|google cloud|oracle|cisco)\s+certified[^\n,]{3,80})/,
  /(?:certificado de conclusao|certificate of completion)\s*(?:do curso|de|of)?\s*[:\-–]?\s*\n?\s*([^\n]{3,120})/,
];
const HOLDER_PATTERNS: RegExp[] = [
  /certifica(?:mos)? que\s+([^\n,]{3,80}?)(?=\s*(?:,|\n|portador|inscrit|cpf|rg|concluiu|participou|completou))/,
  /(?:this is to certify that|certifies that|awarded to|presented to|certify that)\s+([^\n,]{3,80}?)(?=\s*(?:,|\n|has |successfully|$))/,
  /confere o titulo de \w+ a\s*\n?\s*([^\n]{3,80})/,
];
/** Datas próximas destas palavras são preferidas (evita usar a data de nascimento de um diploma). */
const DATE_KEYWORDS = /(emitido|emissao|emitida|conclusao|concluido|concluiu|colacao|realizad[oa]|issued|completed|awarded|data|em)\s*(?:em|on|:)?\s*$/;

function sliceGroup(original: string, m: RegExpExecArray): string {
  const group = m[1]!;
  const start = m.index + m[0].indexOf(group);
  return original.slice(start, start + group.length).replace(/\s+/g, ' ').trim().replace(/[.:;,-]+$/, '').trim();
}

/** Remove números de documentos, datas de nascimento e códigos longos de um trecho de texto. */
export function redactSensitive(text: string): string {
  return text
    .replace(/nascid[oa] em[^,.\n]*/gi, 'nascido(a) em [oculto]')
    .replace(/(identidade|rg|cpf|cnpj|passaporte)(\s*(n[º°o.]*|:)?)\s*[\w./-]*\d[\w./-]*/gi, '$1 [oculto]')
    .replace(/\b\d[\d.\-/ ]{6,}\d\b/g, '[número oculto]');
}

function parseDates(folded: string): { idx: number; value: YearMonth; preferred: boolean }[] {
  const out: { idx: number; value: YearMonth; preferred: boolean }[] = [];
  const pref = (idx: number) => DATE_KEYWORDS.test(folded.slice(Math.max(0, idx - 30), idx));
  const push = (idx: number, value: YearMonth) => out.push({ idx, value, preferred: pref(idx) });
  for (const m of folded.matchAll(new RegExp(`\\b(?:\\d{1,2}\\s+de\\s+)?(${MONTH_ALT})\\.?\\s+(?:de\\s+)?((?:19|20)\\d{2})\\b`, 'g'))) {
    push(m.index!, `${m[2]}-${String(MONTHS[m[1]!]).padStart(2, '0')}`);
  }
  for (const m of folded.matchAll(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+\\d{1,2},?\\s+((?:19|20)\\d{2})\\b`, 'g'))) {
    push(m.index!, `${m[2]}-${String(MONTHS[m[1]!]).padStart(2, '0')}`);
  }
  for (const m of folded.matchAll(/\b\d{1,2}[/.-](\d{1,2})[/.-]((?:19|20)\d{2})\b/g)) {
    if (Number(m[1]) >= 1 && Number(m[1]) <= 12) push(m.index!, `${m[2]}-${m[1]!.padStart(2, '0')}`);
  }
  return out;
}

/** Escolhe a data do certificado: perto de "emitido/conclusão/colação"; senão, a mais recente. */
function chooseDate(folded: string): YearMonth | null {
  const dates = parseDates(folded);
  const preferred = dates.filter((d) => d.preferred);
  const pool = preferred.length ? preferred : dates;
  if (pool.length) return pool.reduce((a, b) => (b.value > a.value ? b : a)).value;
  const years = [...folded.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => m[1]!);
  return years.length ? years.sort().pop()! : null;
}

// ---------------------------------------------------------------------------
// Metadados pelo nome do arquivo/pasta: "Assistente Administrativo (Prime Cursos, 2024).pdf",
// "Profissão Programador (110h, 2023).pdf", ".../Accenture - Python ... (abr-mai-2026)/Listas.pdf"
// ---------------------------------------------------------------------------

interface PathHints {
  baseName: string;
  issuer: string;
  date: YearMonth | null;
  hours: number | null;
  folder: string;
}

export function pathHints(filePath: string): PathHints {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const file = parts.pop() ?? filePath;
  const folder = parts.join(' / ');
  let base = file.replace(/\.[a-z0-9]+$/i, '');
  let issuer = '';
  let date: YearMonth | null = null;
  let hours: number | null = null;

  /**
   * Lê "(Emissor, 2024)", "(110h, 2023)", "(abr-mai-2026)".
   * Emissor só vem de parênteses no fim do nome do arquivo que também tragam ano/horas
   * (ou estejam no fim e pareçam um nome curto) — nunca de pastas, nem de "(POO)" no meio do nome.
   */
  const readParens = (s: string, allowIssuer: boolean) => {
    for (const m of s.matchAll(/\(([^)]*)\)/g)) {
      const tokens = m[1]!.split(',').map((t) => t.trim()).filter(Boolean);
      const atEnd = m.index! + m[0].length >= s.trimEnd().length;
      const hasMeta = tokens.some((t) => /(19|20)\d{2}|^\d{1,4}\s*h/i.test(normalizeText(t)));
      for (const token of tokens) {
        const ft = normalizeText(token);
        const h = /^(\d{1,4})\s*h(oras)?$/.exec(ft);
        if (h) hours ??= Number(h[1]);
        else if (/(19|20)\d{2}/.test(ft)) date ??= chooseDate(ft.replace(/-/g, ' ')) ?? null;
        else if (allowIssuer && atEnd && (hasMeta || tokens.length === 1) && !issuer && token.length <= 40 && !/c[oó]pia|copy|arquivo|vers[aã]o/i.test(token)) {
          issuer = token;
        }
      }
    }
  };
  readParens(base, true);
  base = base
    .replace(/\([^)]*\)/g, '')
    .replace(/^\d{1,3}\s*[-–.]\s*/, '') // "00 - Boas-vindas…"
    .replace(/^(certificado|certificate)\s+(do|da|de|of)?\s*/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Pasta imediata também pode trazer datas: "Bootcamp X (abr-mai-2026)"
  for (const p of [...parts].reverse()) readParens(p, false);
  if (!issuer) issuer = KNOWN_ISSUERS.find(([re]) => re.test(normalizeText(filePath)))?.[1] ?? '';
  return { baseName: base, issuer, date, hours, folder };
}

const NOT_CERTIFICATE_NAME =
  /\b(carta|cover letter|guia|guide|apostila|material|resumo de|anotac|notas|mind map|mapa mental|matricula|e-?mail|senha|password|print|screenshot|captura|whatsapp|img|image|foto|photo|comprovante|boleto|contrato|rg|cpf|cnh)\b/;
/** Pastas cujo conteúdo não é tratado como certificado quando não há texto. */
const NOT_CERTIFICATE_FOLDER = /\b(materiais de estudo|carreira|pessoal|documentos pessoais|downloads)\b/;
const RESUME_NAME = /\b(curr[ií]culo|curriculum|resume|\bcv\b)/i;

export type DocumentClass = 'resume' | 'certificate' | 'other';

/** Classificação inicial pelo caminho (usada quando não há texto legível). */
export function classifyByPath(filePath: string): DocumentClass {
  const parts = filePath.split(/[\\/]/);
  const f = normalizeText(parts.pop() ?? filePath);
  if (RESUME_NAME.test(f) || /^cv[\s_-]/.test(f)) return 'resume';
  if (NOT_CERTIFICATE_NAME.test(f) || NOT_CERTIFICATE_FOLDER.test(normalizeText(parts.join(' ')))) return 'other';
  return 'certificate';
}

/** Classificação pelo texto: currículo (≥ 2 seções típicas), certificado/diploma (âncoras) ou outro. */
export function classifyText(text: string): DocumentClass {
  if (looksLikeResume(text)) return 'resume';
  // Preserva quebras de linha: a âncora "Curso de …" precisa estar no início de uma linha.
  const f = foldPreserving(text.slice(0, 8000));
  if (DEGREE_HINT.test(f) || ANCHOR_RE.test(f)) return text.length < 15_000 ? 'certificate' : 'other';
  return 'other';
}

/** Um documento parece currículo quando tem ao menos duas seções típicas (aceita letras espaçadas). */
export function looksLikeResume(text: string): boolean {
  const lines = text.split('\n').map((l) => {
    const n = normalizeText(l.replace(/[:#*]/g, ' '));
    const tokens = n.split(' ');
    return tokens.length >= 4 && tokens.filter((t) => t.length === 1).length / tokens.length >= 0.7 ? n.replace(/\s+/g, '') : n;
  });
  const sections = [
    /^(experiencias?( ?profissional| ?profissionais)?|historico ?profissional|(work ?|professional ?)?experience)$/,
    /^(formacao( ?academica)?( ?e ?idiomas)?|escolaridade|education)$/,
    /^(habilidades|competencias( ?tecnicas)?|skills|technical ?skills|conhecimentos)$/,
    /^(idiomas|languages)$/,
    /^(resumo( ?profissional)?|objetivo|summary|profile)$/,
  ];
  return sections.filter((re) => lines.some((l) => re.test(l))).length >= 2;
}

function educationLevelFromDegree(folded: string): EducationLevel | null {
  if (/\b(doutor|doctor)/.test(folded)) return 'doctorate';
  if (/\b(mestre|master)/.test(folded)) return 'master';
  if (/\b(especialista|pos-graduacao|mba)/.test(folded)) return 'postgraduate';
  if (/\b(tecnologo)/.test(folded)) return 'associate';
  if (/\b(bacharel|licenciad|bachelor)/.test(folded)) return 'bachelor';
  if (/\b(tecnico em)/.test(folded)) return 'technical';
  return null;
}

/**
 * Lê um certificado (ou diploma) a partir do texto de UMA unidade (uma ou mais páginas).
 * `profileName` é usado só para alertar se o documento estiver em nome de outra pessoa.
 */
export function parseCertificateText(text: string, filePath: string, profileName = ''): CertificateDraft {
  const original = text.replace(/\r\n?/g, '\n').slice(0, 20_000);
  const folded = foldPreserving(original);
  const hints = pathHints(filePath);
  const warnings: string[] = [];
  const isDegree = DEGREE_HINT.test(folded);

  let name = '';
  let educationLevel: EducationLevel | null = null;
  if (isDegree) {
    const course = /conclusao do\s+curso de\s+([^,\n]{3,80})/.exec(folded);
    const title = /confere o titulo de\s+(\w+)/.exec(folded);
    educationLevel = educationLevelFromDegree(title?.[1] ?? folded) ?? 'other';
    name = course ? sliceGroup(original, course) : hints.baseName;
  } else {
    for (const re of NAME_PATTERNS) {
      const m = re.exec(folded);
      if (m?.[1]) {
        name = sliceGroup(original, m).replace(/^minicurso gratuito\s*[-–]\s*/i, '');
        if (name.length >= 3) break;
      }
    }
  }
  if (!name) {
    name = hints.baseName;
    warnings.push('Nome do curso não identificado no texto; foi usado o nome do arquivo.');
  }

  let holderName = '';
  for (const re of HOLDER_PATTERNS) {
    const m = re.exec(folded);
    if (m?.[1]) {
      holderName = sliceGroup(original, m);
      break;
    }
  }
  if (!holderName) {
    // e-certificado / Prime Cursos: nome em maiúsculas na linha anterior a "Concluiu/Participou/Curso de"
    const m = /^([A-ZÀ-Ú][A-ZÀ-Ú' ]{5,80})\s*\n\s*(?:Concluiu|Participou|Curso de|concluiu|participou)/m.exec(original);
    if (m) holderName = m[1]!.trim();
  }
  if (holderName && profileName && !holderMatchesProfile(holderName, profileName)) {
    warnings.push(`O documento parece ter sido emitido para "${holderName}", não para "${profileName}". Verifique antes de importar.`);
  }

  let issuer = '';
  if (isDegree) {
    const inst = /(?:diretor|reitor)\w*\s+d[oa]\s+([^,]{3,100}?)(?=,|\s+no uso)/.exec(folded);
    if (inst) issuer = sliceGroup(original, inst);
  }
  issuer ||= KNOWN_ISSUERS.find(([re]) => re.test(folded))?.[1] ?? hints.issuer;
  if (!issuer) warnings.push('Emissor não identificado.');

  const hoursMatch = /(\d{1,4})\s*\(?[a-z]*\)?\s*(?:h\b|hs\b|horas?\b|hours?\b|horas-aula)/.exec(folded);
  const hours = hoursMatch ? Number(hoursMatch[1]) : hints.hours;

  const date = chooseDate(folded) ?? hints.date;
  if (!date) warnings.push('Data não identificada.');
  if (isDegree) warnings.push('Diploma: a data indicada costuma ser a da colação de grau/emissão, que pode diferir da conclusão do curso.');

  const urlMatch = URL_RE.exec(original)?.[0].replace(/[.]+$/, '') ?? '';
  const credentialUrl = urlMatch && !/tcpdf\.org/i.test(urlMatch) ? (/^https?:\/\//i.test(urlMatch) ? urlMatch : `https://${urlMatch}`) : '';

  const kind: CertificateKind = isDegree ? 'degree' : CERTIFICATION_HINT.test(folded) && hours === null ? 'certification' : 'course';

  return {
    id: newId(),
    filePath,
    kind,
    name: name.slice(0, 200),
    issuer: issuer.slice(0, 120),
    date,
    hours,
    credentialUrl,
    educationLevel,
    holderName,
    basis: 'text',
    snippet: redactSensitive(original.replace(/\s+/g, ' ').trim()).slice(0, 300),
    warnings,
  };
}

/** Rascunho a partir só do nome do arquivo/pasta (certificado em imagem ou sem texto). */
export function certificateFromPath(filePath: string, reason: string): CertificateDraft {
  const h = pathHints(filePath);
  const warnings = [`${reason} Dados inferidos do nome do arquivo e da pasta — confira antes de confirmar.`];
  if (!h.issuer) warnings.push('Emissor não identificado.');
  if (!h.date) warnings.push('Data não identificada.');
  return {
    id: newId(),
    filePath,
    kind: 'course',
    name: h.baseName,
    issuer: h.issuer,
    date: h.date,
    hours: h.hours,
    credentialUrl: '',
    educationLevel: null,
    holderName: '',
    basis: 'file_name',
    snippet: `Arquivo: ${filePath}`,
    warnings,
  };
}

/**
 * Divide um documento de várias páginas em certificados: cada página com âncora inicia um certificado;
 * páginas seguintes sem âncora (verso, conteúdo programático) são anexadas ao anterior.
 */
export function parseCertificateDocument(pages: string[], filePath: string, profileName = ''): CertificateDraft[] {
  // Diploma (frente e verso) é sempre um único documento.
  const whole = pages.join('\n');
  if (DEGREE_HINT.test(foldPreserving(whole))) return [parseCertificateText(whole, filePath, profileName)];
  const units: string[] = [];
  let emptyPages = 0;
  for (const page of pages) {
    if (page.replace(/\s/g, '').length < 20) {
      emptyPages++;
      continue;
    }
    if (ANCHOR_RE.test(foldPreserving(page)) || !units.length) units.push(page);
    else units[units.length - 1] += `\n${page}`;
  }
  const drafts = units.map((u) => parseCertificateText(u, filePath, profileName));
  if (emptyPages && drafts.length) {
    drafts[0]!.warnings.push(`${emptyPages} página(s) deste arquivo são imagem e não puderam ser lidas.`);
  }
  return drafts;
}

/**
 * Compara o titular com o nome do perfil.
 * Retorna false apenas quando ambos existem e não compartilham primeiro e último nome.
 */
export function holderMatchesProfile(holder: string, fullName: string): boolean {
  const h = meaningfulTokens(holder);
  const p = meaningfulTokens(fullName);
  if (!h.length || !p.length) return true;
  return h.includes(p[0]!) && (p.length === 1 || h.includes(p[p.length - 1]!));
}

/** Remove duplicatas entre rascunhos (ex.: mesmo certificado em PDF e em imagem, ou repetido num PDF reunido). */
export function dedupeDrafts(drafts: CertificateDraft[]): CertificateDraft[] {
  const best = new Map<string, CertificateDraft>();
  for (const d of drafts) {
    const key = normalizeText(d.name);
    const prev = best.get(key);
    if (!prev || (prev.basis === 'file_name' && d.basis === 'text')) best.set(key, d);
  }
  return Array.from(best.values());
}

export function folderOf(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * Agrupa vários certificados da mesma pasta (ex.: módulos de um bootcamp) num único curso,
 * nomeado pela pasta. Datas: a mais recente; horas: soma, se todas conhecidas.
 */
export function groupFolder(drafts: CertificateDraft[]): CertificateDraft {
  const folder = folderOf(drafts[0]!.filePath);
  const h = pathHints(`${folder}/x.pdf`);
  const folderName = (folder.split('/').pop() ?? folder)
    .replace(/\([^)]*\)/g, '')
    .replace(/^\d{1,3}\s*[-–.]\s*/, '')
    .trim();
  const dates = drafts.map((d) => d.date).filter((d): d is YearMonth => !!d).sort();
  const hours = drafts.every((d) => d.hours !== null) ? drafts.reduce((s, d) => s + (d.hours ?? 0), 0) : null;
  const issuers = Array.from(new Set(drafts.map((d) => d.issuer).filter(Boolean)));
  const allFromText = drafts.every((d) => d.basis === 'text');
  return {
    id: newId(),
    filePath: `${folder}/`,
    kind: 'course',
    name: folderName,
    issuer: issuers.length === 1 ? issuers[0]! : (h.issuer || issuers.join(', ')),
    date: dates.pop() ?? h.date,
    hours,
    credentialUrl: '',
    educationLevel: null,
    holderName: '',
    basis: allFromText ? 'text' : 'file_name',
    snippet: `${drafts.length} certificados: ${drafts.map((d) => d.name).join('; ')}`.slice(0, 400),
    warnings: [`Agrupa ${drafts.length} certificados da pasta "${folderName}".`],
  };
}

export interface CertificateMergeResult {
  profile: Profile;
  addedCertifications: number;
  addedCourses: number;
  addedEducation: number;
  skippedDuplicates: number;
  /** Diplomas que correspondem a formações já cadastradas (mantidas como estão). */
  matchedExisting: string[];
}

export const KIND_LABELS: Record<CertificateKind, string> = { certification: 'Certificação', course: 'Curso', degree: 'Formação acadêmica' };

/**
 * Adiciona os rascunhos escolhidos ao perfil sem duplicar e sem alterar itens existentes.
 * Itens lidos do texto entram como "extraídos"; inferidos do nome do arquivo, como "pendentes".
 */
export function mergeCertificates(profile: Profile, drafts: CertificateDraft[], source: SourceKind, now: string): CertificateMergeResult {
  const next = structuredClone(profile);
  const seen = new Set([...next.certifications.map((c) => normalizeText(c.name)), ...next.courses.map((c) => normalizeText(c.name))]);
  const result: Omit<CertificateMergeResult, 'profile'> = { addedCertifications: 0, addedCourses: 0, addedEducation: 0, skippedDuplicates: 0, matchedExisting: [] };

  for (const d of drafts) {
    const status: ValidationStatus = d.basis === 'text' ? 'extracted' : 'pending';
    const provenance: Provenance = { source, status, sourceSnippet: `Arquivo: ${d.filePath}${d.basis === 'text' ? ` — ${d.snippet}` : ''}`.slice(0, 400), updatedAt: now };

    if (d.kind === 'degree') {
      // Formação já cadastrada (mesmo curso/nível) não é alterada: a data do perfil é preservada.
      const nameTokens = meaningfulTokens(d.name);
      const existing = next.education.find(
        (e) => (d.educationLevel === null || e.level === d.educationLevel) && nameTokens.some((t) => meaningfulTokens(`${e.degree} ${e.field}`).includes(t)),
      );
      if (existing) {
        result.matchedExisting.push(`${EDUCATION_LEVEL_LABELS[existing.level]}: ${existing.degree || existing.field}`);
        continue;
      }
      const edu: Education = {
        id: newId(),
        institution: d.issuer,
        degree: d.name,
        field: d.name,
        level: d.educationLevel ?? 'other',
        status: 'completed',
        startDate: null,
        endDate: d.date,
        provenance,
      };
      next.education.push(edu);
      result.addedEducation++;
      continue;
    }

    const key = normalizeText(d.name);
    if (!key || seen.has(key)) {
      result.skippedDuplicates++;
      continue;
    }
    seen.add(key);
    if (d.kind === 'certification') {
      const c: Certification = { id: newId(), name: d.name, issuer: d.issuer, issueDate: d.date, expirationDate: null, credentialUrl: d.credentialUrl, provenance };
      next.certifications.push(c);
      result.addedCertifications++;
    } else {
      const c: Course = { id: newId(), name: d.name, institution: d.issuer, hours: d.hours, completionDate: d.date, provenance };
      next.courses.push(c);
      result.addedCourses++;
    }
  }
  next.updatedAt = now;
  return { profile: next, ...result };
}
