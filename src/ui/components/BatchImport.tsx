import { useMemo, useState } from 'react';
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
import { extractDocxText } from '../../infra/documents/docx';
import { repo } from '../shared';

/** Pastas com muitos certificados (ex.: módulos de bootcamp) começam agrupadas. */
const AUTO_GROUP_MIN = 4;

function toBatchFiles(list: FileList): BatchFile[] {
  return Array.from(list).map((f) => ({
    path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    size: f.size,
    lastModified: f.lastModified,
    read: async () => new Uint8Array(await f.arrayBuffer()),
  }));
}

export function BatchImport({ onResume }: { onResume: (text: string, source: SourceKind) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; path: string } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Partial<Pick<CertificateDraft, 'name' | 'kind'>>>>({});
  const [resumePath, setResumePath] = useState<string>('');
  const [merged, setMerged] = useState<CertificateMergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    setMerged(null);
    try {
      const profile = await repo.loadProfile();
      const { extractPdfPages } = await import('../../infra/documents/pdf');
      const r = await processBatch(toBatchFiles(list), profile?.personal.fullName ?? '', { pdfPages: extractPdfPages, docx: extractDocxText }, (done, total, path) =>
        setProgress({ done, total, path }),
      );
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

  const apply = async () => {
    setBusy(true);
    try {
      const profile = (await repo.loadProfile()) ?? createEmptyProfile();
      const r = mergeCertificates(profile, finalDrafts(), 'certificate_file', nowIso());
      await repo.saveProfile(r.profile);
      setMerged(r);
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
      <h2>Pasta ou vários arquivos (currículos + certificados)</h2>
      <p className="small muted">
        Escolha a pasta onde você guarda currículo, diplomas e certificados. O ApplyPilot lê PDF, DOCX e TXT; certificados em imagem (PNG, JPG, WEBP) ou PDFs
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
          Adicionados: {merged.addedCourses} curso(s), {merged.addedCertifications} certificação(ões), {merged.addedEducation} formação(ões).
          {merged.skippedDuplicates > 0 && ` ${merged.skippedDuplicates} já existiam e foram ignorados.`}
          {merged.matchedExisting.length > 0 && ` Diploma(s) correspondentes a formações já cadastradas (mantidas como estão): ${merged.matchedExisting.join('; ')}.`}{' '}
          <a href="#/profile">Revisar e confirmar no perfil</a>
        </div>
      )}

      {result && !merged && (
        <div style={{ marginTop: 12 }}>
          <p>
            <strong>{result.resumes.length}</strong> currículo(s), <strong>{result.certificates.length}</strong> certificado(s)/diploma(s),{' '}
            <strong>{result.skipped.length}</strong> documento(s) não usados e {result.ignoredCount} arquivo(s) ignorados (não são documentos).
          </p>

          {result.resumes.length > 0 && (
            <div className="card compact">
              <h3>Currículos encontrados</h3>
              <p className="small muted">O mais recente vem primeiro. Escolha um para revisar e importar os dados.</p>
              {result.resumes.map((r) => (
                <label key={r.path} className="inline" style={{ display: 'flex' }}>
                  <input type="radio" name="resume" checked={resumePath === r.path} onChange={() => setResumePath(r.path)} />
                  {r.path} <span className="small muted">({new Date(r.lastModified).toLocaleDateString('pt-BR')})</span>
                </label>
              ))}
              <button
                disabled={!resumePath}
                onClick={() => {
                  const r = result.resumes.find((x) => x.path === resumePath);
                  if (r) onResume(r.text, r.source);
                }}
              >
                Revisar este currículo
              </button>
            </div>
          )}

          {byFolder.length > 0 && (
            <>
              <div className="row between" style={{ margin: '12px 0 8px' }}>
                <h3 style={{ margin: 0 }}>Certificados e diplomas ({selected.size} selecionados)</h3>
                <button className="primary" disabled={busy || selected.size === 0} onClick={apply}>
                  Adicionar selecionados ao perfil
                </button>
              </div>
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
