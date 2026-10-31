export type DocumentKind = 'pdf' | 'docx' | 'txt';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
/** PDFs com vários certificados reunidos costumam ser maiores. */
export const MAX_BATCH_FILE_BYTES = 30 * 1024 * 1024;

export interface FileValidation {
  ok: boolean;
  kind?: DocumentKind;
  error?: string;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/**
 * Valida extensão, tamanho e assinatura binária (magic bytes) do arquivo.
 * A extensão sozinha não é confiável; o conteúdo precisa corresponder ao tipo declarado.
 */
export function validateResumeFile(meta: { name: string; size: number }, head: Uint8Array, maxBytes = MAX_RESUME_BYTES): FileValidation {
  const ext = meta.name.toLowerCase().split('.').pop() ?? '';
  if (meta.size === 0) return { ok: false, error: 'O arquivo está vazio.' };
  if (meta.size > maxBytes) return { ok: false, error: `Arquivo maior que ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  switch (ext) {
    case 'pdf':
      return startsWith(head, PDF_MAGIC) ? { ok: true, kind: 'pdf' } : { ok: false, error: 'O conteúdo não corresponde a um PDF válido.' };
    case 'docx':
      return startsWith(head, ZIP_MAGIC) ? { ok: true, kind: 'docx' } : { ok: false, error: 'O conteúdo não corresponde a um DOCX válido.' };
    case 'txt':
      return head.includes(0) ? { ok: false, error: 'O arquivo de texto contém dados binários.' } : { ok: true, kind: 'txt' };
    case 'doc':
      return { ok: false, error: 'Formato .doc (Word 97-2003) não é suportado. Salve como .docx ou PDF.' };
    default:
      return { ok: false, error: 'Formato não suportado. Use PDF, DOCX ou TXT.' };
  }
}
