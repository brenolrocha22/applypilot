import type { EducationLevel, LanguageLevel, WorkMode } from './profile';
import type { FitReport } from './fit';

/** Referência a um trecho da descrição original (offsets em caracteres). */
export interface SourceSpan {
  start: number;
  end: number;
  text: string;
}

export type Importance = 'required' | 'preferred' | 'unspecified';

export type Dimension = 'technical' | 'experience' | 'education' | 'language' | 'culture';

export type RequirementKind =
  | 'skill' // competência técnica, ferramenta ou metodologia
  | 'years_experience'
  | 'responsibility'
  | 'seniority'
  | 'education'
  | 'certification'
  | 'language'
  | 'work_mode'
  | 'location'
  | 'travel'
  | 'autonomy'
  | 'collaboration'
  | 'schedule'
  | 'other'; // linha de requisito não estruturada

export type SectionKind =
  | 'required'
  | 'preferred'
  | 'responsibilities'
  | 'benefits'
  | 'culture'
  | 'about'
  | 'location'
  | 'unknown';

export interface JobRequirement {
  id: string;
  kind: RequirementKind;
  dimension: Dimension;
  importance: Importance;
  /** Requisito marcado explicitamente como eliminatório/obrigatório na vaga. */
  eliminatory: boolean;
  /** Descrição curta e normalizada do requisito. */
  label: string;
  source: SourceSpan;
  /** Parâmetros estruturados (dependem de `kind`). */
  skillId?: string;
  skillName?: string;
  minYears?: number;
  /** Para anos de experiência: competências a que o tempo se refere (vazio = experiência geral). */
  scopeSkillIds?: string[];
  educationLevel?: EducationLevel;
  certificationName?: string;
  language?: string;
  languageLevel?: LanguageLevel;
  workMode?: WorkMode;
  travel?: 'occasional' | 'frequent';
  cultureValue?: string;
}

export interface ParsedSection {
  kind: SectionKind;
  heading: string | null;
  source: SourceSpan;
}

export interface ParsedJob {
  responsibilities: SourceSpan[];
  requirements: JobRequirement[];
  sections: ParsedSection[];
  minYearsExperience: number | null;
  seniority: 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | null;
  workModes: WorkMode[];
  locations: string[];
  /** Linhas de requisitos que não puderam ser estruturadas. */
  unstructuredLines: SourceSpan[];
  warnings: string[];
}

export type ApplicationStatus =
  | 'analyzed'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  analyzed: 'Analisada',
  applied: 'Candidatura enviada',
  interviewing: 'Em entrevistas',
  offer: 'Proposta recebida',
  rejected: 'Não selecionado',
  withdrawn: 'Desisti',
};

export interface JobInput {
  title: string;
  company: string;
  sourceUrl: string;
  description: string;
}

export interface SavedJob {
  id: string;
  input: JobInput;
  parsed: ParsedJob;
  report: FitReport;
  status: ApplicationStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
