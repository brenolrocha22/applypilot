import type {
  Importance,
  JobInput,
  JobRequirement,
  ParsedJob,
  ParsedSection,
  SectionKind,
  SourceSpan,
} from '../model/job';
import type { WorkMode } from '../model/profile';
import { detectEducationLevel, educationRank } from '../knowledge/education';
import { detectLanguageLevel, findLanguages, languageLevelRank, languageName } from '../knowledge/languages';
import { foldPreserving } from '../knowledge/normalize';
import { findSkillMentions, getSkill, skillDisplayName, type SkillDefinition } from '../knowledge/skills';

/**
 * Parser de vagas baseado em regras (sem IA).
 * Todo requisito extraído guarda o trecho original (`source`) para revisão.
 * A descrição é tratada como dado não confiável: nada nela é executado ou interpretado como instrução.
 */

import { MAX_DESCRIPTION_LENGTH } from './limits';

export { MAX_DESCRIPTION_LENGTH };

const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  ['preferred', /^(diferenciais|diferencial|desejavel|desejaveis|requisitos desejaveis|qualificacoes desejaveis|sera um diferencial|serao diferenciais|sera um plus|nice[- ]to[- ]have|preferred( qualifications)?|bonus( points)?|pontos extras|extras)\b/],
  ['required', /^(requisitos( obrigatorios| necessarios| tecnicos)?|requisitos e qualificacoes|qualificacoes( necessarias| obrigatorias| tecnicas)?|o que (voce precisa( ter)?|buscamos|esperamos( de voce)?|procuramos)|pre[- ]?requisitos|perfil (desejado|tecnico|da vaga)|must[- ]haves?|requirements|required qualifications|minimum qualifications|qualifications|what you('ll)? need|what we('re)? looking for|competencias( tecnicas| necessarias)?|habilidades( tecnicas| necessarias)?)\b/],
  ['responsibilities', /^(responsabilidades|atribuicoes|atividades|principais (atividades|responsabilidades)|o que voce (vai|ira) fazer|seu dia a dia|no dia a dia|desafios|responsibilities|what you('ll)? do|your role|key responsibilities|day[- ]to[- ]day)\b/],
  ['benefits', /^(beneficios|o que oferecemos|oferecemos|benefits|perks|we offer|remuneracao)\b/],
  ['culture', /^(nossa cultura|cultura|sobre (o )?time|sobre a equipe|valores|nossos valores|culture|our values|how we work|como trabalhamos|ambiente de trabalho)\b/],
  ['location', /^(local( de trabalho)?|localizacao|modelo de trabalho|regime de trabalho|modalidade|location|work model|workplace)\b/],
  ['about', /^(sobre (a|nos|a empresa|a vaga|o cargo|a oportunidade)|quem somos|about( us| the company| the role)?|descricao( da vaga)?|a vaga|a empresa)\b/],
];

const BULLET_RE = /^\s*(?:[-*•●▪◦·–—>]|\d{1,2}[.)])\s*/;
const PREFERRED_MARK = /(desejavel|diferencial|nice to have|is a plus|sera um plus|e um plus|preferencialmente|preferably|preferred|bonus|sera considerado um plus)/;
const REQUIRED_MARK = /(obrigatori[oa]|imprescindivel|indispensavel|eliminatori[oa]|essencial|mandatory|must have|must|required|necessari[oa])/;
const ELIMINATORY_MARK = /(obrigatori[oa]|imprescindivel|indispensavel|eliminatori[oa]|mandatory|must have)/;

interface Line {
  text: string; // original, sem marcador de lista
  folded: string;
  start: number; // offset na descrição original
  end: number;
}

function splitLines(description: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of description.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1;
    const bullet = BULLET_RE.exec(raw);
    const contentStart = bullet ? bullet[0].length : raw.length - raw.trimStart().length;
    const content = raw.slice(contentStart).replace(/\s+$/, '');
    if (!content.trim()) continue;
    lines.push({ text: content, folded: foldPreserving(content), start: lineStart + contentStart, end: lineStart + contentStart + content.length });
  }
  return lines;
}

/** Detecta se a linha é um título de seção. Retorna o tipo e o conteúdo após ":" (se houver). */
function detectHeading(line: Line): { kind: SectionKind; rest: Line | null } | null {
  const clean = line.folded.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim();
  for (const [kind, re] of SECTION_PATTERNS) {
    if (!re.test(clean)) continue;
    const colon = line.text.indexOf(':');
    if (colon >= 0 && line.text.slice(colon + 1).trim().length > 2) {
      // "Requisitos: Java, SQL" → seção + conteúdo na mesma linha
      const restStartInLine = colon + 1 + (line.text.slice(colon + 1).length - line.text.slice(colon + 1).trimStart().length);
      const restText = line.text.slice(restStartInLine);
      return {
        kind,
        rest: { text: restText, folded: foldPreserving(restText), start: line.start + restStartInLine, end: line.end },
      };
    }
    // Títulos são curtos; linhas longas que começam com "Atividades ..." são conteúdo.
    if (clean.length <= 60) return { kind, rest: null };
  }
  return null;
}

function span(line: Line, from = 0, to = line.text.length): SourceSpan {
  return { start: line.start + from, end: line.start + to, text: line.text.slice(from, to) };
}

function lineImportance(section: SectionKind, folded: string): { importance: Importance; eliminatory: boolean } {
  const eliminatory = ELIMINATORY_MARK.test(folded);
  if (PREFERRED_MARK.test(folded) && !eliminatory) return { importance: 'preferred', eliminatory: false };
  if (REQUIRED_MARK.test(folded)) return { importance: 'required', eliminatory };
  if (section === 'required') return { importance: 'required', eliminatory: false };
  if (section === 'preferred') return { importance: 'preferred', eliminatory: false };
  return { importance: 'unspecified', eliminatory: false };
}

const YEARS_RANGE_RE = /(\d{1,2})\s*(?:a|-|–|to|ate)\s*\d{1,2}\s*\+?\s*(?:anos|years|yrs)/;
const YEARS_RE = /(\d{1,2})\s*\+?\s*(?:anos|years|yrs)/;
const EXPERIENCE_CTX = /(experiencia|experience|atuacao|vivencia|trabalhando|working)/;

const WORK_MODE_PATTERNS: [WorkMode, RegExp][] = [
  ['remote', /(100% remot|\bremot[oa]\b|\bremote\b|trabalho remoto|work from home|anywhere)/],
  ['hybrid', /(\bhibrid[oa]\b|\bhybrid\b)/],
  ['onsite', /(\bpresencial\b|\bon-?site\b|in[- ]office|no escritorio)/],
];
const HOME_OFFICE_RE = /\bhome office\b/;
const LOCATION_AFTER_MODE_RE = /(?:presencial|hibrido|hibrida|hybrid|on-?site)\s*(?:em|in|-|–|:|\()\s*([a-z][a-z .\/'-]{2,40})/;
const LOCATION_LABEL_RE = /^(?:local(?:izacao)?(?: de trabalho)?|location|cidade)\s*:\s*(.{2,60})$/;
const TRAVEL_RE = /(disponibilidade para viag|viagens|viajar|travel)/;
const TRAVEL_FREQUENT_RE = /(frequent|constante|regular|semanal|\b[3-9]\d\s*%)/;
const AUTONOMY_RE = /(autonomia|autonom[oa]|autogerenci|self[- ]?starter|ownership|senso de dono|independently|de forma independente)/;
const COLLAB_RE = /(trabalho em equipe|colaborativ|colaboracao|\bcolaborar\b|teamwork|team player|collaborat|pair programming|multidisciplinar|cross[- ]functional)/;
const SCHEDULE_PATTERNS: [string, RegExp][] = [
  ['flexible', /(horario flexivel|horarios flexiveis|flexible (hours|schedule)|flexibilidade de horario|jornada flexivel)/],
  ['shifts', /(\bescala\b|\bturnos?\b|\bshifts?\b|plantao|plantoes|finais de semana|weekends)/],
  ['fixed', /(horario comercial|segunda a sexta|business hours)/],
];
const CERT_RE = /(?:certificacao|certificacoes|certificado|certification|certified)\s*(?:em|in|de|:)?\s*([^,;.()]{2,60})/;
const CERT_NAMED_RE = /\b(pmp|cspo|cspm|csm|psm(?: i{1,3})?|itil|cobit|cissp|ccna|cpa-?\d{2}|aws certified [a-z ]+|azure (?:fundamentals|administrator|developer)[a-z ]*|az-\d{3}|scrum master)\b/;

const SENIORITY_PATTERNS: [NonNullable<ParsedJob['seniority']>, RegExp][] = [
  ['intern', /\b(estagi\w*|intern(ship)?|trainee)\b/],
  ['lead', /\b(tech lead|lider tecnico|lideranca tecnica|principal|staff|head|coordenador\w*|gerente)\b/],
  ['senior', /\b(senior|sr\.?|especialista)\b/],
  ['mid', /\b(pleno|mid[- ]level)\b/],
  ['junior', /\b(junior|jr\.?)\b/],
];
export const SENIORITY_EXPECTED_YEARS: Record<NonNullable<ParsedJob['seniority']>, number> = {
  intern: 0,
  junior: 1,
  mid: 3,
  senior: 5,
  lead: 7,
};
export const SENIORITY_LABELS: Record<NonNullable<ParsedJob['seniority']>, string> = {
  intern: 'Estágio/Trainee',
  junior: 'Júnior',
  mid: 'Pleno',
  senior: 'Sênior',
  lead: 'Liderança/Especialista',
};

const IMPORTANCE_RANK: Record<Importance, number> = { required: 3, preferred: 2, unspecified: 1 };

export interface ParseOptions {
  /** Vocabulário adicional (ex.: competências do perfil fora do dicionário). */
  extraVocabulary?: SkillDefinition[];
}

export function parseJob(input: JobInput, options: ParseOptions = {}): ParsedJob {
  const description = input.description.slice(0, MAX_DESCRIPTION_LENGTH);
  const warnings: string[] = [];
  if (input.description.length > MAX_DESCRIPTION_LENGTH) {
    warnings.push(`Descrição truncada em ${MAX_DESCRIPTION_LENGTH} caracteres.`);
  }

  const lines = splitLines(description);
  const sections: ParsedSection[] = [];
  const responsibilities: SourceSpan[] = [];
  const unstructuredLines: SourceSpan[] = [];
  const reqs: Omit<JobRequirement, 'id'>[] = [];
  const workModes = new Set<WorkMode>();
  const locations: string[] = [];
  let minYears: number | null = null;
  let section: SectionKind = 'unknown';
  let sawHeading = false;

  const push = (r: Omit<JobRequirement, 'id'>) => reqs.push(r);

  for (const original of lines) {
    let line = original;
    const heading = detectHeading(line);
    if (heading) {
      section = heading.kind;
      sawHeading = true;
      sections.push({ kind: heading.kind, heading: line.text, source: span(line) });
      if (!heading.rest) continue;
      line = heading.rest;
    }

    const f = line.folded;
    const { importance, eliminatory } = lineImportance(section, f);
    const isRequirementSection = section === 'required' || section === 'preferred' || section === 'unknown';
    const allowsCulture = section !== 'benefits' || !HOME_OFFICE_RE.test(f);
    let structured = 0;

    // Modalidade e localização (qualquer seção, exceto "home office" citado como benefício)
    if (allowsCulture) {
      for (const [mode, re] of WORK_MODE_PATTERNS) {
        if (re.test(f) || (mode === 'remote' && section !== 'benefits' && HOME_OFFICE_RE.test(f))) {
          if (!workModes.has(mode)) {
            workModes.add(mode);
            push({ kind: 'work_mode', dimension: 'culture', importance: 'unspecified', eliminatory: false, label: `Modalidade: ${WORK_MODE_LABEL[mode]}`, source: span(line), workMode: mode });
          }
          structured++;
        }
      }
    }
    const locMatch = LOCATION_AFTER_MODE_RE.exec(f) ?? LOCATION_LABEL_RE.exec(f);
    let loc: string | null = null;
    if (locMatch?.[1]) {
      // O grupo capturado está sempre no fim do match.
      const startIdx = locMatch.index + locMatch[0].length - locMatch[1].length;
      loc = line.text.slice(startIdx, startIdx + locMatch[1].length).trim().replace(/[.)]+$/, '');
    } else if (section === 'location' && structured === 0 && line.text.length <= 60) {
      loc = line.text.trim();
    }
    if (loc) {
      const found = loc;
      if (!locations.some((l) => l.toLowerCase() === found.toLowerCase())) {
        locations.push(loc);
        push({ kind: 'location', dimension: 'culture', importance: 'unspecified', eliminatory: false, label: `Local: ${loc}`, source: span(line), cultureValue: loc });
      }
      structured++;
    }

    // Viagens, autonomia, colaboração, horários
    if (TRAVEL_RE.test(f) && section !== 'benefits') {
      const travel = TRAVEL_FREQUENT_RE.test(f) ? 'frequent' : 'occasional';
      push({ kind: 'travel', dimension: 'culture', importance, eliminatory, label: travel === 'frequent' ? 'Viagens frequentes' : 'Disponibilidade para viagens', source: span(line), travel });
      structured++;
    }
    if (AUTONOMY_RE.test(f)) {
      push({ kind: 'autonomy', dimension: 'culture', importance: 'unspecified', eliminatory: false, label: 'Ambiente com autonomia', source: span(line), cultureValue: 'high' });
      structured++;
    }
    if (COLLAB_RE.test(f)) {
      push({ kind: 'collaboration', dimension: 'culture', importance: 'unspecified', eliminatory: false, label: 'Trabalho colaborativo/em equipe', source: span(line), cultureValue: 'collaborative' });
      structured++;
    }
    for (const [value, re] of SCHEDULE_PATTERNS) {
      if (re.test(f)) {
        push({ kind: 'schedule', dimension: 'culture', importance: 'unspecified', eliminatory: false, label: SCHEDULE_LABEL[value] ?? value, source: span(line), cultureValue: value });
        structured++;
      }
    }

    if (section === 'responsibilities') {
      responsibilities.push(span(line));
      push({ kind: 'responsibility', dimension: 'experience', importance: 'unspecified', eliminatory: false, label: line.text, source: span(line) });
      // Tecnologias citadas nas responsabilidades viram requisitos de importância não especificada.
      for (const m of findSkillMentions(line.text, options.extraVocabulary)) {
        push(skillReq(m.skillId, 'unspecified', false, line, m.start, m.end, options.extraVocabulary));
      }
      continue;
    }
    if (section === 'benefits' || section === 'about' || section === 'culture' || section === 'location') {
      continue;
    }

    // Seções de requisitos (ou texto sem seções)
    const skillMentions = findSkillMentions(line.text, options.extraVocabulary);
    for (const m of skillMentions) {
      push(skillReq(m.skillId, importance, eliminatory, line, m.start, m.end, options.extraVocabulary));
      structured++;
    }

    const yearsMatch = YEARS_RANGE_RE.exec(f) ?? YEARS_RE.exec(f);
    // Exige contexto de experiência: "maior de 18 anos" não é tempo de experiência.
    if (yearsMatch?.[1] && EXPERIENCE_CTX.test(f)) {
      const years = Number(yearsMatch[1]);
      if (years > 0 && years <= 40) {
        const scope = skillMentions.map((m) => m.skillId);
        const scopeNames = scope.map((id) => skillDisplayName(id, vocabName(id, options.extraVocabulary)));
        push({
          kind: 'years_experience',
          dimension: 'experience',
          importance,
          eliminatory,
          label: scope.length ? `${years}+ anos de experiência com ${scopeNames.join(', ')}` : `${years}+ anos de experiência`,
          source: span(line),
          minYears: years,
          scopeSkillIds: scope,
        });
        if (!scope.length) minYears = Math.max(minYears ?? 0, years);
        structured++;
      }
    }

    if (isRequirementSection) {
      const eduLevel = detectEducationLevel(line.text);
      if (eduLevel) {
        push({ kind: 'education', dimension: 'education', importance, eliminatory, label: line.text.length <= 120 ? line.text : `Formação: ${eduLevel}`, source: span(line), educationLevel: eduLevel });
        structured++;
      }
      const cert = CERT_NAMED_RE.exec(f) ?? CERT_RE.exec(f);
      if (cert?.[1]) {
        const idx = cert.index + cert[0].length - cert[1].length;
        const name = line.text.slice(idx, idx + cert[1].length).trim();
        push({ kind: 'certification', dimension: 'education', importance, eliminatory, label: `Certificação: ${name}`, source: span(line), certificationName: name });
        structured++;
      }
      for (const lang of findLanguages(line.text)) {
        const level = detectLanguageLevel(line.text);
        const r: Omit<JobRequirement, 'id'> = {
          kind: 'language',
          dimension: 'language',
          importance,
          eliminatory,
          label: `${languageName(lang.id)}${level ? ` (${LEVEL_LABEL[level]})` : ''}`,
          source: span(line),
          language: lang.id,
        };
        if (level) r.languageLevel = level;
        push(r);
        structured++;
      }
    }

    if (structured === 0 && (section === 'required' || section === 'preferred')) {
      push({ kind: 'other', dimension: 'experience', importance, eliminatory, label: line.text, source: span(line) });
      unstructuredLines.push(span(line));
    }
  }

  // Senioridade vem só do título (na descrição, palavras como "principal" geram falsos positivos)
  // e só vira requisito quando não há anos de experiência explícitos.
  const seniority = detectSeniority(input.title);
  if (seniority && seniority !== 'intern' && minYears === null) {
    push({
      kind: 'seniority',
      dimension: 'experience',
      importance: 'unspecified',
      eliminatory: false,
      label: `Senioridade ${SENIORITY_LABELS[seniority]} (referência: ~${SENIORITY_EXPECTED_YEARS[seniority]} anos)`,
      source: { start: -1, end: -1, text: `Título da vaga: ${input.title}` },
      minYears: SENIORITY_EXPECTED_YEARS[seniority],
    });
  }

  const requirements = dedupe(reqs).map((r, i) => ({ ...r, id: `req-${i + 1}` }));

  if (!sawHeading) warnings.push('Nenhuma seção (requisitos, diferenciais, responsabilidades) foi identificada: a importância dos requisitos ficou como "não especificada".');
  if (!requirements.some((r) => r.dimension !== 'culture')) warnings.push('Poucos requisitos foram identificados automaticamente. Revise a descrição original.');
  if (unstructuredLines.length) warnings.push(`${unstructuredLines.length} linha(s) de requisitos não puderam ser estruturadas e foram avaliadas apenas por semelhança textual.`);

  return {
    responsibilities,
    requirements,
    sections,
    minYearsExperience: minYears,
    seniority,
    workModes: Array.from(workModes),
    locations,
    unstructuredLines,
    warnings,
  };
}

const WORK_MODE_LABEL: Record<WorkMode, string> = { remote: 'remoto', hybrid: 'híbrido', onsite: 'presencial' };
const SCHEDULE_LABEL: Record<string, string> = { flexible: 'Horário flexível', shifts: 'Escala/turnos ou fins de semana', fixed: 'Horário comercial fixo' };
const LEVEL_LABEL = { basic: 'básico', intermediate: 'intermediário', advanced: 'avançado', fluent: 'fluente', native: 'nativo' } as const;

function vocabName(id: string, extra?: SkillDefinition[]): string | undefined {
  return extra?.find((s) => s.id === id)?.name;
}

function skillReq(
  skillId: string,
  importance: Importance,
  eliminatory: boolean,
  line: Line,
  start: number,
  end: number,
  extra?: SkillDefinition[],
): Omit<JobRequirement, 'id'> {
  const def = getSkill(skillId) ?? extra?.find((s) => s.id === skillId);
  const name = def?.name ?? line.text.slice(start, end);
  return {
    kind: 'skill',
    dimension: def?.category === 'behavioral' ? 'experience' : 'technical',
    importance,
    eliminatory,
    label: name,
    source: span(line),
    skillId,
    skillName: name,
  };
}

function detectSeniority(text: string): ParsedJob['seniority'] {
  const f = foldPreserving(text);
  for (const [level, re] of SENIORITY_PATTERNS) if (re.test(f)) return level;
  return null;
}

/** Remove duplicatas mantendo a ocorrência de maior importância (e preservando a ordem de aparição). */
function dedupe(reqs: Omit<JobRequirement, 'id'>[]): Omit<JobRequirement, 'id'>[] {
  const keyOf = (r: Omit<JobRequirement, 'id'>): string | null => {
    switch (r.kind) {
      case 'skill':
        return `skill:${r.skillId}`;
      case 'language':
        return `lang:${r.language}`;
      case 'education':
        return `edu:${r.educationLevel}`;
      case 'certification':
        return `cert:${r.certificationName?.toLowerCase()}`;
      case 'work_mode':
        return `mode:${r.workMode}`;
      case 'autonomy':
      case 'collaboration':
      case 'schedule':
      case 'travel':
        return `${r.kind}:${r.cultureValue ?? r.travel}`;
      case 'years_experience':
        return `years:${(r.scopeSkillIds ?? []).join(',')}`;
      default:
        return null;
    }
  };
  const out: Omit<JobRequirement, 'id'>[] = [];
  const index = new Map<string, number>();
  for (const r of reqs) {
    const key = keyOf(r);
    if (key === null) {
      out.push(r);
      continue;
    }
    const existingIdx = index.get(key);
    if (existingIdx === undefined) {
      index.set(key, out.length);
      out.push(r);
      continue;
    }
    const existing = out[existingIdx]!;
    const stronger = IMPORTANCE_RANK[r.importance] > IMPORTANCE_RANK[existing.importance];
    const higherLevel =
      (r.kind === 'language' && r.languageLevel && (!existing.languageLevel || languageLevelRank(r.languageLevel) > languageLevelRank(existing.languageLevel))) ||
      (r.kind === 'years_experience' && (r.minYears ?? 0) > (existing.minYears ?? 0)) ||
      (r.kind === 'education' && r.educationLevel && existing.educationLevel && educationRank(r.educationLevel) > educationRank(existing.educationLevel));
    if (stronger || higherLevel) {
      out[existingIdx] = { ...r, eliminatory: r.eliminatory || existing.eliminatory, importance: stronger ? r.importance : existing.importance };
    } else if (r.eliminatory && !existing.eliminatory) {
      out[existingIdx] = { ...existing, eliminatory: true };
    }
  }
  return out;
}
