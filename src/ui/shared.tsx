import { createDefaultStore } from '../infra/storage/adapters';
import { Repository } from '../infra/storage/repository';
import type { AttachableFile } from '../core/fill/types';
import type { RequirementStatus } from '../core/model/fit';
import { REQUIREMENT_STATUS_LABELS } from '../core/model/fit';
import type { Importance } from '../core/model/job';
import { VALIDATION_STATUS_LABELS, type Provenance } from '../core/model/provenance';

/** Repositório único das páginas da extensão. */
export const repo = new Repository(createDefaultStore());

export function extensionUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : `/${path}`;
}

/** Lê um arquivo escolhido pelo usuário no formato guardado pela extensão (para anexar em formulários). */
export async function toAttachableFile(file: File): Promise<AttachableFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, base64: btoa(binary), savedAt: new Date().toISOString() };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PROV_CLASS: Record<Provenance['status'], string> = { confirmed: 'ok', extracted: 'warn', pending: 'warn', ai_suggested: 'info' };

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <span className={`badge ${PROV_CLASS[provenance.status]}`} title={provenance.sourceSnippet ? `Origem: ${provenance.sourceSnippet}` : undefined}>
      {VALIDATION_STATUS_LABELS[provenance.status]}
    </span>
  );
}

const STATUS_CLASS: Record<RequirementStatus, string> = {
  met: 'ok',
  partially_met: 'warn',
  not_proven: 'info',
  not_met: 'bad',
  not_applicable: 'neutral',
};

export function StatusBadge({ status }: { status: RequirementStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{REQUIREMENT_STATUS_LABELS[status]}</span>;
}

const IMPORTANCE_LABEL: Record<Importance, string> = { required: 'Obrigatório', preferred: 'Desejável', unspecified: 'Não especificado' };
export function ImportanceBadge({ importance, eliminatory }: { importance: Importance; eliminatory?: boolean }) {
  if (eliminatory) return <span className="badge bad">Eliminatório</span>;
  return <span className={`badge ${importance === 'required' ? 'warn' : 'neutral'}`}>{IMPORTANCE_LABEL[importance]}</span>;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
