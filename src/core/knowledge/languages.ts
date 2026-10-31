import type { LanguageLevel } from '../model/profile';
import { normalizeText } from './normalize';

export interface LanguageDefinition {
  id: string;
  name: string;
  aliases: string[];
}

export const LANGUAGES: LanguageDefinition[] = [
  { id: 'english', name: 'Inglês', aliases: ['ingles', 'english', 'lingua inglesa'] },
  { id: 'spanish', name: 'Espanhol', aliases: ['espanhol', 'spanish', 'castelhano', 'lingua espanhola'] },
  { id: 'portuguese', name: 'Português', aliases: ['portugues', 'portuguese'] },
  { id: 'french', name: 'Francês', aliases: ['frances', 'french'] },
  { id: 'german', name: 'Alemão', aliases: ['alemao', 'german'] },
  { id: 'italian', name: 'Italiano', aliases: ['italiano', 'italian'] },
  { id: 'mandarin', name: 'Mandarim', aliases: ['mandarim', 'mandarin', 'chines', 'chinese'] },
  { id: 'japanese', name: 'Japonês', aliases: ['japones', 'japanese'] },
];

export const LANGUAGE_LEVEL_ORDER: LanguageLevel[] = ['basic', 'intermediate', 'advanced', 'fluent', 'native'];

export const LANGUAGE_LEVEL_LABELS: Record<LanguageLevel, string> = {
  basic: 'Básico',
  intermediate: 'Intermediário',
  advanced: 'Avançado',
  fluent: 'Fluente',
  native: 'Nativo',
};

/** Ordem importa: termos mais específicos primeiro. */
const LEVEL_PATTERNS: [RegExp, LanguageLevel][] = [
  [/\b(nativo|native|lingua materna|mother tongue)\b/, 'native'],
  [/\b(fluente|fluencia|fluent|fluency|c2|proficient|proficiencia)\b/, 'fluent'],
  [/\b(avancado|advanced|c1)\b/, 'advanced'],
  [/\b(intermediario|intermediate|b1|b2|conversacao|conversational)\b/, 'intermediate'],
  [/\b(basico|basic|a1|a2|elementar|elementary)\b/, 'basic'],
];

export function detectLanguageLevel(text: string): LanguageLevel | null {
  const n = normalizeText(text);
  for (const [re, level] of LEVEL_PATTERNS) if (re.test(n)) return level;
  return null;
}

export function resolveLanguageId(name: string): string | undefined {
  const n = normalizeText(name);
  return LANGUAGES.find((l) => l.aliases.includes(n) || normalizeText(l.name) === n)?.id;
}

export function findLanguages(text: string): LanguageDefinition[] {
  const n = normalizeText(text);
  return LANGUAGES.filter((l) => l.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(n)));
}

export function languageLevelRank(level: LanguageLevel): number {
  return LANGUAGE_LEVEL_ORDER.indexOf(level);
}

export function languageName(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.name ?? id;
}
