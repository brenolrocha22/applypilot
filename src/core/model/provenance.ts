/**
 * Origem e estado de validação de cada informação do perfil.
 * Regra central: nada extraído ou sugerido vira "confirmado" sem ação explícita do usuário.
 */

export type ValidationStatus =
  | 'confirmed' // Confirmado pelo usuário
  | 'extracted' // Extraído de documento
  | 'ai_suggested' // Sugerido pela IA (reservado; não há IA no MVP)
  | 'pending'; // Pendente de confirmação

export type SourceKind = 'manual' | 'resume_pdf' | 'resume_docx' | 'resume_text' | 'certificate_file' | 'linkedin_export' | 'json_import' | 'ai';

export interface Provenance {
  source: SourceKind;
  status: ValidationStatus;
  /** Trecho do documento de origem que gerou a informação (para revisão). */
  sourceSnippet?: string;
  updatedAt: string;
}

export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  confirmed: 'Confirmado pelo usuário',
  extracted: 'Extraído de documento',
  ai_suggested: 'Sugerido pela IA',
  pending: 'Pendente de confirmação',
};

/**
 * Peso da evidência no cálculo de fit, por estado de validação.
 * Sugestões de IA nunca contam como evidência.
 */
export const EVIDENCE_CONFIDENCE: Record<ValidationStatus, number> = {
  confirmed: 1,
  extracted: 0.8,
  pending: 0.8,
  ai_suggested: 0,
};

export function manualProvenance(now: string): Provenance {
  return { source: 'manual', status: 'confirmed', updatedAt: now };
}

export function isConfirmed(p: Provenance): boolean {
  return p.status === 'confirmed';
}
