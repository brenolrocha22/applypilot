/** Descrição de um campo de formulário, independente do DOM (permite testar o mapeamento sem navegador). */
export interface FieldDescriptor {
  key: string;
  tag: 'input' | 'textarea' | 'select';
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  autocomplete: string;
  ariaLabel: string;
  currentValue: string;
  options: { value: string; label: string }[];
  required: boolean;
  disabled: boolean;
}

export type ProfileFieldKey =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'city'
  | 'state'
  | 'country'
  | 'location'
  | 'linkedinUrl'
  | 'githubUrl'
  | 'portfolioUrl'
  | 'headline'
  | 'summary'
  | 'currentTitle'
  | 'currentCompany'
  | 'yearsOfExperience'
  | 'highestEducation'
  | 'englishLevel'
  | 'desiredSalary'
  | 'workMode'
  | 'willingToRelocate';

export type FillAction =
  | 'fill' // preencher (campo vazio, correspondência encontrada)
  | 'same_value' // já contém o mesmo valor
  | 'skip_has_value' // já contém outro valor: só substitui com aprovação explícita
  | 'ambiguous' // mais de uma correspondência possível ou opção não encontrada
  | 'no_match' // campo não reconhecido
  | 'no_profile_value' // reconhecido, mas o perfil não tem o dado
  | 'blocked'; // dado sensível, segurança ou tipo não suportado

export interface MatchCandidate {
  profileField: ProfileFieldKey;
  confidence: number;
  reason: string;
}

export interface FillPlanItem {
  field: FieldDescriptor;
  profileField: ProfileFieldKey | null;
  candidates: MatchCandidate[];
  /** Valor proposto (para select, o `value` da opção). */
  value: string | null;
  confidence: number;
  action: FillAction;
  reason: string;
  /** Pré-selecionado para preenchimento na revisão. */
  selectedByDefault: boolean;
  /** Exige atenção do usuário (baixa confiança, dado sensível, origem não confirmada). */
  requiresReview: boolean;
}

export interface FillLogEntry {
  fieldKey: string;
  fieldLabel: string;
  profileField: ProfileFieldKey | null;
  action: FillAction;
  result: 'filled' | 'skipped' | 'failed';
  message?: string;
}

/** Registro da operação. Não guarda valores preenchidos (privacidade). */
export interface FillLog {
  id: string;
  timestamp: string;
  page: string;
  entries: FillLogEntry[];
  filled: number;
  skipped: number;
  failed: number;
}
