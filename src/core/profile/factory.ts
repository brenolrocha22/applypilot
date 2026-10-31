import {
  PROFILE_SCHEMA_VERSION,
  type Certification,
  type Course,
  type Education,
  type Experience,
  type LanguageSkill,
  type Profile,
  type Skill,
} from '../model/profile';
import { manualProvenance, type Provenance } from '../model/provenance';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyProfile(now = nowIso()): Profile {
  const prov = manualProvenance(now);
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    personal: {
      fullName: '',
      headline: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      country: '',
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
      provenance: prov,
    },
    summary: { text: '', provenance: prov },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    courses: [],
    preferences: {
      workModes: [],
      preferredLocations: [],
      willingToRelocate: null,
      travelAvailability: null,
      autonomy: null,
      collaboration: null,
      schedule: null,
      employmentTypes: [],
      desiredSalary: '',
      provenance: prov,
    },
  };
}

export function emptyExperience(prov: Provenance): Experience {
  return {
    id: newId(),
    title: '',
    company: '',
    location: '',
    startDate: null,
    endDate: null,
    current: false,
    description: '',
    achievements: [],
    skills: [],
    provenance: prov,
  };
}

export function emptyEducation(prov: Provenance): Education {
  return {
    id: newId(),
    institution: '',
    degree: '',
    field: '',
    level: 'bachelor',
    status: 'completed',
    startDate: null,
    endDate: null,
    provenance: prov,
  };
}

export function emptySkill(prov: Provenance): Skill {
  return { id: newId(), name: '', category: 'technical', provenance: prov };
}

export function emptyLanguage(prov: Provenance): LanguageSkill {
  return { id: newId(), name: '', level: 'intermediate', provenance: prov };
}

export function emptyCertification(prov: Provenance): Certification {
  return { id: newId(), name: '', issuer: '', issueDate: null, expirationDate: null, credentialUrl: '', provenance: prov };
}

export function emptyCourse(prov: Provenance): Course {
  return { id: newId(), name: '', institution: '', hours: null, completionDate: null, provenance: prov };
}
