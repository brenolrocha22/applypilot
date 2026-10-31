import type { EducationLevel } from '../model/profile';
import { normalizeText } from './normalize';

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  high_school: 'Ensino médio',
  technical: 'Curso técnico',
  associate: 'Tecnólogo',
  bachelor: 'Graduação (bacharelado/licenciatura)',
  postgraduate: 'Pós-graduação / MBA',
  master: 'Mestrado',
  doctorate: 'Doutorado',
  other: 'Outro',
};

/**
 * Ordem hierárquica. Tecnólogo é tratado como superior completo (nível igual a bacharelado)
 * por ser graduação no Brasil; a justificativa aparece no relatório.
 */
const RANK: Record<EducationLevel, number> = {
  other: 0,
  high_school: 1,
  technical: 2,
  associate: 3,
  bachelor: 3,
  postgraduate: 4,
  master: 5,
  doctorate: 6,
};

export function educationRank(level: EducationLevel): number {
  return RANK[level];
}

const PATTERNS: [RegExp, EducationLevel][] = [
  [/\b(doutorado|phd|ph\.d|doctorate)\b/, 'doctorate'],
  [/\b(mestrado|master'?s degree|msc|m\.sc)\b/, 'master'],
  [/\b(pos[- ]graduacao|especializacao|mba|postgraduate)\b/, 'postgraduate'],
  [
    /\b(ensino superior|superior completo|graduacao|graduado|bacharelado|bacharel|licenciatura|bachelor'?s?( degree)?|degree in|formacao superior|nivel superior)\b/,
    'bachelor',
  ],
  [/\b(tecnologo|tecnologia em)\b/, 'associate'],
  [/\b(curso tecnico|tecnico em|ensino tecnico)\b/, 'technical'],
  [/\b(ensino medio|high school)\b/, 'high_school'],
];

export function detectEducationLevel(text: string): EducationLevel | null {
  const n = normalizeText(text);
  for (const [re, level] of PATTERNS) if (re.test(n)) return level;
  return null;
}
