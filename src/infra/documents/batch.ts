import type { SourceKind } from '../../core/model/provenance';
import {
  certificateFromPath,
  classifyByPath,
  classifyText,
  dedupeDrafts,
  parseCertificateDocument,
  type CertificateDraft,
} from '../../core/resume/certificate';
import { MAX_BATCH_FILE_BYTES, validateResumeFile } from './validate';

/**
 * Importação em lote (vários arquivos ou uma pasta). Tudo local.
 * Os extratores são injetados para permitir testes no Node e uso no navegador.
 */

export interface BatchFile {
  /** Caminho relativo dentro da seleção (ex.: "Cursos/HTML e CSS.pdf"). */
  path: string;
  size: number;
  lastModified: number;
  read(): Promise<Uint8Array>;
}

export interface Extractors {
  pdfPages(bytes: Uint8Array): Promise<string[]>;
  docx(bytes: Uint8Array): Promise<string>;
}

export interface FoundResume {
  path: string;
  text: string;
  source: SourceKind;
  lastModified: number;
}

export interface BatchResult {
  resumes: FoundResume[];
  certificates: CertificateDraft[];
  skipped: { path: string; reason: string }[];
  /** Arquivos ignorados por não serem documentos (estilos, scripts, executáveis…), só a contagem. */
  ignoredCount: number;
}

export const MAX_BATCH_FILES = 300;
const DOC_EXT = new Set(['pdf', 'docx', 'txt']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
/** Pastas de páginas salvas ("X_files") e pastas ocultas/sistema não são lidas. */
const IGNORED_DIR = /(^|\/)(\.[^/]+|node_modules|__macosx|[^/]*_files)(\/|$)/i;

export function isCandidate(path: string): 'document' | 'image' | null {
  const p = path.replace(/\\/g, '/');
  if (IGNORED_DIR.test(p)) return null;
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  if (DOC_EXT.has(ext)) return 'document';
  if (IMAGE_EXT.has(ext)) return 'image';
  return null;
}

const SOURCE_BY_EXT: Record<string, SourceKind> = { pdf: 'resume_pdf', docx: 'resume_docx', txt: 'resume_text' };

export async function processBatch(
  files: BatchFile[],
  profileName: string,
  extractors: Extractors,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<BatchResult> {
  const result: BatchResult = { resumes: [], certificates: [], skipped: [], ignoredCount: 0 };
  const candidates = files.filter((f) => {
    const ok = isCandidate(f.path) !== null;
    if (!ok) result.ignoredCount++;
    return ok;
  });
  if (candidates.length > MAX_BATCH_FILES) {
    result.skipped.push({ path: '(seleção)', reason: `Mais de ${MAX_BATCH_FILES} documentos: apenas os primeiros ${MAX_BATCH_FILES} foram processados.` });
  }
  const drafts: CertificateDraft[] = [];

  const list = candidates.slice(0, MAX_BATCH_FILES);
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    onProgress?.(i, list.length, f.path);
    const kind = isCandidate(f.path)!;
    const byPath = classifyByPath(f.path);
    const noText = (reason: string) => {
      if (byPath === 'certificate') drafts.push(certificateFromPath(f.path, reason));
      else result.skipped.push({ path: f.path, reason: byPath === 'resume' ? `${reason} Currículo sem texto legível não pode ser lido.` : `${reason} Não parece ser certificado.` });
    };

    if (f.size > MAX_BATCH_FILE_BYTES) {
      result.skipped.push({ path: f.path, reason: 'Arquivo maior que 30 MB.' });
      continue;
    }
    if (kind === 'image') {
      noText('Certificado em imagem (sem texto legível).');
      continue;
    }

    try {
      const bytes = await f.read();
      const name = f.path.split('/').pop() ?? f.path;
      const check = validateResumeFile({ name, size: f.size }, bytes.subarray(0, 8), MAX_BATCH_FILE_BYTES);
      if (!check.ok) {
        result.skipped.push({ path: f.path, reason: check.error ?? 'Arquivo inválido.' });
        continue;
      }
      const pages = check.kind === 'pdf' ? await extractors.pdfPages(bytes) : [check.kind === 'docx' ? await extractors.docx(bytes) : new TextDecoder().decode(bytes)];
      const full = pages.join('\n');
      if (full.replace(/\s/g, '').length < 30) {
        noText('PDF em imagem (sem texto legível).');
        continue;
      }
      let cls = classifyText(full);
      if (cls !== 'resume' && byPath === 'resume') cls = 'resume';
      if (cls === 'other' && byPath === 'other') {
        result.skipped.push({ path: f.path, reason: 'Não parece certificado nem currículo.' });
        continue;
      }
      if (cls === 'resume') {
        result.resumes.push({ path: f.path, text: full, source: SOURCE_BY_EXT[check.kind!]!, lastModified: f.lastModified });
      } else if (cls === 'certificate') {
        drafts.push(...parseCertificateDocument(pages, f.path, profileName));
      } else {
        result.skipped.push({ path: f.path, reason: 'Não parece certificado nem currículo.' });
      }
    } catch (e) {
      result.skipped.push({ path: f.path, reason: `Falha na leitura: ${(e as Error).message}` });
    }
  }
  onProgress?.(list.length, list.length, '');
  result.certificates = dedupeDrafts(drafts);
  result.resumes.sort((a, b) => b.lastModified - a.lastModified);
  return result;
}
