import { useMemo, useRef, useState } from 'react';
import type { SourceKind } from '../../core/model/provenance';
import { createEmptyProfile, nowIso } from '../../core/profile/factory';
import {
  folderOf,
  groupFolder,
  KIND_LABELS,
  mergeCertificates,
  type CertificateDraft,
  type CertificateKind,
  type CertificateMergeResult,
} from '../../core/resume/certificate';
import { processBatch, type BatchFile, type BatchResult } from '../../infra/documents/batch';
import { readLinkedInExport, zipLooksLikeLinkedInExport } from '../../infra/documents/linkedin';
import { mergeDraftIntoProfile, selectAll } from '../../core/profile/merge';
import { parseResumeText } from '../../core/resume/parser';
import type { Profile } from '../../core/model/profile';
import { extractDocxText } from '../../infra/documents/docx';
import { MAX_ATTACHMENT_BYTES } from '../../infra/storage/repository';
import { repo, toAttachableFile } from '../shared';

/** Pastas com muitos certificados (ex.: módulos de bootcamp) começam agrupadas. */
const AUTO_GROUP_MIN = 4;

const pathOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

function toBatchFiles(list: FileList): BatchFile[] {
  return Array.from(list).map((f) => ({
    path: pathOf(f),
    size: f.size,
    lastModified: f.lastModified,
    read: async () => new Uint8Array(await f.arrayBuffer()),
  }));
}

interface ImportSummary {
  personalFields: string[];
  summary: boolean;
  added: Record<'experiences' | 'education' | 'skills' | 'languages' | 'certifications' | 'courses', number>;
  duplicates: number;
  kept: string[];
  matchedExisting: string[];
  /** Nome do arquivo de currículo guardado para anexar em formulários. */
  attachedFile?: string;
}

function emptySummary(): ImportSummary {
  return { personalFields: [], summary: false, added: { experiences: 0, education: 0, skills: 0, languages: 0, certifications: 0, courses: 0 }, duplicates: 0, kept: [], matchedExisting: [] };
}

const PERSONAL_NAMES: Record<string, string> = {
  fullName: 'nome', headline: 'título', email: 'e-mail', phone: 'telefone', city: 'cidade', state: 'estado', country: 'país',
  linkedinUrl: 'LinkedIn', githubUrl: 'GitHub', portfolioUrl: 'portfólio',
};

export function BatchImport({ onResume }: { onResume: (text: string, source: SourceKind) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; path: string } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Partial<Pick<CertificateDraft, 'name' | 'kind'>>>>({});
  const [resumePath, setResumePath] = useState<string>('');
  const [merged, setMerged] = useState<ImportSummary | null>(null);
  const [useResume, setUseResume] = useState(true);
  const [useLinkedIn, setUseLinkedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filesByPath = useRef<Map<string, File>>(new Map());

  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    setMerged(null);
    try {
      filesByPath.current = new Map(Array.from(list).map((f) => [pathOf(f), f]));
      const profile = await repo.loadProfile();
      const { extractPdfPages } = await import('../../infra/documents/pdf');
      const extractors = {
        pdfPages: extractPdfPages,
        docx: extractDocxText,
        linkedin: async (b: Uint8Array) => (zipLooksLikeLinkedInExport(b) ? readLinkedInExport(b) : null),
      };
      const r = await processBatch(toBatchFiles(list), profile?.personal.fullName ?? '', extractors, (done, total, path) => setProgress({ done, total, path }));
      setResult(r);
      setResumePath(r.resumes[0]?.path ?? '');
      // Pré-seleção: tudo, exceto documentos em nome de outra pessoa.
      setSelected(new Set(r.certificates.filter((c) => !c.warnings.some((w) => w.includes('emitido para'))).map((c) => c.id)));
      const counts = new Map<string, number>();
      for (const c of r.certificates) counts.set(folderOf(c.filePath), (counts.get(folderOf(c.filePath)) ?? 0) + 1);
      setGrouped(new Set(Array.from(counts).filter(([folder, n]) => folder && n >= AUTO_GROUP_MIN).map(([f]) => f)));
      setEdits({});
    } catch (e) {
      setError(`Falha ao processar os arquivos: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const byFolder = useMemo(() => {
    const map = new Map<string, CertificateDraft[]>();
    for (const c of result?.certificates ?? []) {
      const f = folderOf(c.filePath);
      map.set(f, [...(map.get(f) ?? []), c]);
    }
    return Array.from(map).sort(([a], [b]) => a.localeCompare(b));
  }, [result]);

  const finalDrafts = (): CertificateDraft[] => {
    const out: CertificateDraft[] = [];
    for (const [folder, items] of byFolder) {
      const chosen = items.filter((c) => selected.has(c.id)).map((c) => ({ ...c, ...edits[c.id] }));
      const degrees = chosen.filter((c) => c.kind === 'degree');
      const others = chosen.filter((c) => c.kind !== 'degree');
      out.push(...degrees);
      if (grouped.has(folder) && others.length >= 2) out.push(groupFolder(others));
      else out.push(...others);
    }
    return out;
  };

  /**
   * Botão único: currículo escolhido + exportação do LinkedIn + certificados selecionados, numa só gravação.
   * Ordem: currículo primeiro (geralmente o mais atualizado); o LinkedIn só completa o que faltar.
   * Nada já existente é sobrescrito; tudo entra como "extraído"/"pendente" até ser confirmado no perfil.
   */
  const apply = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const now = nowIso();
      let profile: Profile = (await repo.loadProfile()) ?? createEmptyProfile();
      const sum = emptySummary();
      const mergeDraft = (draft: Parameters<typeof mergeDraftIntoProfile>[1]) => {
        const before = profile;
        const m = mergeDraftIntoProfile(profile, draft, selectAll(draft), now);
        profile = m.profile;
        for (const k of Object.keys(m.added) as (keyof ImportSummary['added'])[]) sum.added[k] += m.added[k];
        sum.duplicates += m.skippedDuplicates;
        sum.kept.push(...m.conflicts.map((c) => c.field));
        for (const f of Object.keys(PERSONAL_NAMES) as (keyof typeof before.personal)[]) {
          if (!before.personal[f] && profile.personal[f] && !sum.personalFields.includes(PERSONAL_NAMES[f]!)) sum.personalFields.push(PERSONAL_NAMES[f]!);
        }
        if (!before.summary.text && profile.summary.text) sum.summary = true;
      };
      const resume = useResume ? result.resumes.find((x) => x.path === resumePath) : undefined;
      if (resume) mergeDraft(parseResumeText(resume.text, resume.source, now));
      if (useLinkedIn && result.linkedin) mergeDraft(result.linkedin.draft);
      const drafts = finalDrafts();
      if (drafts.length) {
        const c: CertificateMergeResult = mergeCertificates(profile, drafts, 'certificate_file', now);
        profile = c.profile;
        sum.added.courses += c.addedCourses;
        sum.added.certifications += c.addedCertifications;
        sum.added.education += c.addedEducation;
        sum.duplicates += c.skippedDuplicates;
        sum.matchedExisting.push(...c.matchedExisting);
      }
      await repo.saveProfile(profile);
      // O currículo escolhido também fica guardado para anexar em campos de arquivo dos formulários.
      const resumeFile = resume && !/\.txt$/i.test(resume.path) ? filesByPath.current.get(resume.path) : undefined;
      if (resumeFile && resumeFile.size <= MAX_ATTACHMENT_BYTES) {
        await repo.saveResumeFile(await toAttachableFile(resumeFile));
        sum.attachedFile = resumeFile.name;
      }
      setMerged(sum);
    } catch (e) {
      setError(`Falha ao importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setter(n);
  };

  const folderToggle = (items: CertificateDraft[], on: boolean) => {
    const n = new Set(selected);
    for (const c of items) {
      if (on) n.add(c.id);
      else n.delete(c.id);
    }
    setSelected(n);
  };

  return (
    <div className="card">
      <h2>Pasta ou vários arquivos (currículo + certificados + LinkedIn)</h2>
      <p className="small muted">
        Escolha a pasta onde você guarda currículo, diplomas e certificados. O ApplyPilot lê PDF, DOCX, TXT e o .zip de dados do LinkedIn; certificados em imagem (PNG, JPG, WEBP) ou PDFs
        escaneados são registrados pelo nome do arquivo e da pasta, como “pendentes de confirmação”. Outros arquivos são ignorados. Nada sai do seu computador.
      </p>
      <div className="row">
        <label className="btn primary" style={{ margin: 0 }}>
          Escolher pasta
          <input
            type="file"
            style={{ display: 'none' }}
            disabled={busy}
            ref={(el) => el?.setAttribute('webkitdirectory', '')}
            onChange={(e) => run(e.target.files)}
          />
        </label>
        <label className="btn" style={{ margin: 0 }}>
          Escolher arquivos
          <input type="file" multiple style={{ display: 'none' }} disabled={busy} accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={(e) => run(e.target.files)} />
        </label>
      </div>
      {progress && (
        <p className="small" style={{ marginTop: 8 }}>
          Lendo {progress.done + 1} de {progress.total}: {progress.path.split('/').pop()}
        </p>
      )}
      {error && <div className="alert bad" style={{ marginTop: 8 }}>{error}</div>}

      {merged && (
        <div className="alert ok" style={{ marginTop: 12 }}>
          <strong>Perfil atualizado.</strong>
          <ul>
            {merged.personalFields.length > 0 && <li>Dados pessoais preenchidos: {merged.personalFields.join(', ')}.</li>}
            {merged.summary && <li>Resumo profissional preenchido.</li>}
            <li>
              Adicionados: {merged.added.experiences} experiência(s), {merged.added.education} formação(ões), {merged.added.skills} competência(s), {merged.added.languages}{' '}
              idioma(s), {merged.added.courses} curso(s) e {merged.added.certifications} certificação(ões).
            </li>
            {merged.duplicates > 0 && <li>{merged.duplicates} item(ns) já existiam e foram ignorados.</li>}
            {merged.kept.length > 0 && <li>Campos que já tinham valor foram mantidos: {merged.kept.join(', ')}.</li>}
            {merged.attachedFile && <li>Arquivo “{merged.attachedFile}” guardado para anexar nos campos de currículo dos formulários.</li>}
            {merged.matchedExisting.length > 0 && <li>Diploma(s) de formação já cadastrada (datas mantidas): {merged.matchedExisting.join('; ')}.</li>}
          </ul>
          Os itens importados ficam marcados como “Extraído de documento” até você confirmar.{' '}
          <a href="#/profile">
            <strong>Abrir o perfil para revisar e confirmar →</strong>
          </a>
        </div>
      )}

      {result && !merged && (
        <div style={{ marginTop: 12 }}>
          <p>
            <strong>{result.resumes.length}</strong> currículo(s), <strong>{result.certificates.length}</strong> certificado(s)/diploma(s),{' '}
            <strong>{result.skipped.length}</strong> documento(s) não usados e {result.ignoredCount} arquivo(s) ignorados (não são documentos).
          </p>

          <div className="card compact">
            <h3>O que será adicionado ao perfil</h3>
            {result.resumes.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <label className="inline">
                  <input type="checkbox" checked={useResume} onChange={(e) => setUseResume(e.target.checked)} />
                  <strong>Currículo</strong> (dados pessoais, resumo, experiências, formação, competências, idiomas, cursos):
                </label>
                {result.resumes.map((r) => (
                  <label key={r.path} className="inline small" style={{ display: 'flex', marginLeft: 24 }}>
                    <input type="radio" name="resume" disabled={!useResume} checked={resumePath === r.path} onChange={() => setResumePath(r.path)} />
                    {r.path.split('/').pop()} <span className="muted">({new Date(r.lastModified).toLocaleDateString('pt-BR')})</span>
                  </label>
                ))}
                <button
                  className="small"
                  style={{ marginLeft: 24 }}
                  disabled={!resumePath}
                  onClick={() => {
                    const r = result.resumes.find((x) => x.path === resumePath);
                    if (r) onResume(r.text, r.source);
                  }}
                >
                  Prefiro revisar o currículo item a item antes
                </button>
              </div>
            ) : (
              <p className="small muted">Nenhum currículo com texto legível foi encontrado.</p>
            )}
            {result.linkedin ? (
              <label className="inline" style={{ display: 'flex', marginBottom: 8 }}>
                <input type="checkbox" checked={useLinkedIn} onChange={(e) => setUseLinkedIn(e.target.checked)} />
                <span>
                  <strong>Exportação do LinkedIn</strong> ({result.linkedin.path.split('/').pop()}): {result.linkedin.draft.experiences.length} cargo(s),{' '}
                  {result.linkedin.draft.education.length} formação(ões), {result.linkedin.draft.skills.length} competência(s) — completa o que faltar no currículo.
                </span>
              </label>
            ) : (
              <p className="small muted">
                Exportação do LinkedIn não encontrada. Para incluí-la, baixe seus dados do LinkedIn (veja “LinkedIn” abaixo) e coloque o .zip nesta pasta.
              </p>
            )}
            <p className="small" style={{ marginBottom: 8 }}>
              <strong>Certificados e diplomas:</strong> {selected.size} selecionado(s) — revise a lista abaixo se quiser.
            </p>
            <button className="primary" disabled={busy || (!(useResume && resumePath) && !(useLinkedIn && result.linkedin) && selected.size === 0)} onClick={apply}>
              Adicionar tudo ao perfil
            </button>
            <p className="small muted" style={{ marginTop: 6 }}>Nada que já está no seu perfil é substituído. Você confirma cada item depois, no perfil.</p>
          </div>

          {byFolder.length > 0 && (
            <>
              <h3 style={{ margin: '12px 0 8px' }}>Certificados e diplomas ({selected.size} selecionados)</h3>
              {byFolder.map(([folder, items]) => {
                const allOn = items.every((c) => selected.has(c.id));
                return (
                  <details key={folder} className="item" open={items.length <= 6}>
                    <summary>
                      {folder || '(arquivos soltos)'} — {items.filter((c) => selected.has(c.id)).length}/{items.length}
                    </summary>
                    <div className="row" style={{ margin: '6px 0' }}>
                      <label className="inline small">
                        <input type="checkbox" checked={allOn} onChange={(e) => folderToggle(items, e.target.checked)} /> Selecionar todos
                      </label>
                      {items.length >= 2 && folder && (
                        <label className="inline small" title="Útil para módulos de um mesmo bootcamp">
                          <input type="checkbox" checked={grouped.has(folder)} onChange={() => toggle(grouped, setGrouped, folder)} /> Importar como um único curso (“
                          {folder.split('/').pop()?.replace(/\([^)]*\)/g, '').trim()}”)
                        </label>
                      )}
                    </div>
                    {items.map((c) => {
                      const e = { ...c, ...edits[c.id] };
                      return (
                        <div key={c.id} className="req">
                          <div className="row">
                            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(selected, setSelected, c.id)} aria-label={`Selecionar ${c.name}`} />
                            <input
                              value={e.name}
                              maxLength={200}
                              style={{ flex: 1, minWidth: 200 }}
                              onChange={(ev) => setEdits({ ...edits, [c.id]: { ...edits[c.id], name: ev.target.value } })}
                            />
                            <select
                              style={{ width: 'auto' }}
                              value={e.kind}
                              onChange={(ev) => setEdits({ ...edits, [c.id]: { ...edits[c.id], kind: ev.target.value as CertificateKind } })}
                            >
                              {(Object.keys(KIND_LABELS) as CertificateKind[]).map((k) => (
                                <option key={k} value={k}>
                                  {KIND_LABELS[k]}
                                </option>
                              ))}
                            </select>
                            <span className={`badge ${c.basis === 'text' ? 'ok' : 'warn'}`}>{c.basis === 'text' ? 'lido do documento' : 'pelo nome do arquivo'}</span>
                          </div>
                          <div className="small muted">
                            {[c.issuer || 'emissor ?', c.date ?? 'data ?', c.hours !== null ? `${c.hours} h` : null, c.filePath.split('/').pop()].filter(Boolean).join(' · ')}
                          </div>
                          {c.warnings.map((w, i) => (
                            <div key={i} className={`small ${w.includes('emitido para') ? '' : 'muted'}`} style={w.includes('emitido para') ? { color: 'var(--bad)' } : undefined}>
                              ⚠ {w}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </details>
                );
              })}
            </>
          )}

          {result.skipped.length > 0 && (
            <details className="item">
              <summary>Documentos não usados ({result.skipped.length})</summary>
              <ul className="small">
                {result.skipped.map((s) => (
                  <li key={s.path}>
                    {s.path} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
