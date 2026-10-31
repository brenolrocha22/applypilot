import type { SourceKind } from '../../core/model/provenance';
import { extractDocxText } from './docx';
import { validateResumeFile } from './validate';

export interface ExtractedDocument {
  text: string;
  source: SourceKind;
}

/** Valida e extrai o texto de um currículo enviado pelo usuário. Lança erro com mensagem legível. */
export async function extractResumeText(file: File): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateResumeFile({ name: file.name, size: file.size }, bytes.subarray(0, 8));
  if (!check.ok) throw new Error(check.error);

  let text: string;
  let source: SourceKind;
  switch (check.kind) {
    case 'pdf': {
      const { extractPdfText } = await import('./pdf');
      text = await extractPdfText(bytes);
      source = 'resume_pdf';
      break;
    }
    case 'docx':
      text = await extractDocxText(bytes);
      source = 'resume_docx';
      break;
    default:
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      source = 'resume_text';
  }
  if (text.replace(/\s/g, '').length < 30) {
    throw new Error('Pouco ou nenhum texto foi extraído. O arquivo pode ser uma imagem escaneada; use o cadastro manual ou cole o texto.');
  }
  return { text, source };
}
