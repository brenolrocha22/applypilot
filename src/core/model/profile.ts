import type { Provenance } from './provenance';

/** Datas parciais no formato "YYYY-MM" (ou "YYYY"). */
export type YearMonth = string;

export type SkillCategory = 'technical' | 'tool' | 'behavioral' | 'methodology' | 'domain';
export type SkillLevel = 'basic' | 'intermediate' | 'advanced' | 'expert';
export type LanguageLevel = 'basic' | 'intermediate' | 'advanced' | 'fluent' | 'native';
export type EducationLevel =
  | 'high_school'
  | 'technical'
  | 'associate' // tecnólogo
  | 'bachelor'
  | 'postgraduate' // especialização / MBA
  | 'master'
  | 'doctorate'
  | 'other';
export type EducationStatus = 'completed' | 'in_progress' | 'incomplete';
export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type TravelAvailability = 'none' | 'occasional' | 'frequent';
export type AutonomyPreference = 'high' | 'moderate' | 'structured';
export type CollaborationPreference = 'collaborative' | 'balanced' | 'independent';
export type SchedulePreference = 'flexible' | 'fixed' | 'shifts_ok';
export type EmploymentType = 'clt' | 'pj' | 'internship' | 'temporary' | 'freelance';

export interface PersonalInfo {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  provenance: Provenance;
}

export interface Summary {
  text: string;
  provenance: Provenance;
}

export interface Experience {
  id: string;
  title: string;
  company: string;
  location: string;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  current: boolean;
  description: string;
  achievements: string[];
  /** Competências usadas nesta experiência (declaradas pelo usuário ou extraídas). */
  skills: string[];
  provenance: Provenance;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  level: EducationLevel;
  status: EducationStatus;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  provenance: Provenance;
}

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  level?: SkillLevel;
  yearsOfExperience?: number;
  provenance: Provenance;
}

export interface LanguageSkill {
  id: string;
  name: string;
  level: LanguageLevel;
  provenance: Provenance;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  issueDate: YearMonth | null;
  expirationDate: YearMonth | null;
  credentialUrl: string;
  provenance: Provenance;
}

export interface Course {
  id: string;
  name: string;
  institution: string;
  hours: number | null;
  completionDate: YearMonth | null;
  provenance: Provenance;
}

/**
 * Preferências declaradas. Usadas somente no fit cultural.
 * Campo ausente/vazio = "não declarado" (nunca inferido do currículo).
 */
export interface WorkPreferences {
  workModes: WorkMode[];
  preferredLocations: string[];
  willingToRelocate: boolean | null;
  travelAvailability: TravelAvailability | null;
  autonomy: AutonomyPreference | null;
  collaboration: CollaborationPreference | null;
  schedule: SchedulePreference | null;
  employmentTypes: EmploymentType[];
  desiredSalary: string;
  provenance: Provenance;
}

export const PROFILE_SCHEMA_VERSION = 1;

export interface Profile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  createdAt: string;
  updatedAt: string;
  personal: PersonalInfo;
  summary: Summary;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  languages: LanguageSkill[];
  certifications: Certification[];
  courses: Course[];
  preferences: WorkPreferences;
}

export type ProfileListKey = 'experiences' | 'education' | 'skills' | 'languages' | 'certifications' | 'courses';
