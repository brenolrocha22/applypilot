import { isLinkedInExport, linkedInExportToDraft } from '../../core/linkedin/export';
import type { ResumeDraft } from '../../core/resume/parser';
import { listZipEntries, readZipTextEntries } from './zip';

/** Arquivos da exportação do LinkedIn usados pelo ApplyPilot (os demais — mensagens, conexões etc. — nem são lidos). */
const USED_FILES = new Set([
  'profile.csv',
  'positions.csv',
  'education.csv',
  'skills.csv',
  'languages.csv',
  'certifications.csv',
  'courses.csv',
  'email addresses.csv',
  'phonenumbers.csv',
]);

export function zipLooksLikeLinkedInExport(bytes: Uint8Array): boolean {
  try {
    return isLinkedInExport(listZipEntries(bytes).map((e) => e.name));
  } catch {
    return false;
  }
}

/** Lê o .zip "Basic_LinkedInDataExport_…" e devolve um rascunho revisável. */
export async function readLinkedInExport(bytes: Uint8Array): Promise<ResumeDraft> {
  if (!zipLooksLikeLinkedInExport(bytes)) {
    throw new Error('Este .zip não parece ser a exportação de dados do LinkedIn (não contém Profile.csv e Positions/Education/Skills.csv).');
  }
  const files = await readZipTextEntries(bytes, (name) => USED_FILES.has(name.split('/').pop()!.toLowerCase()), 5 * 1024 * 1024);
  return linkedInExportToDraft(files);
}
