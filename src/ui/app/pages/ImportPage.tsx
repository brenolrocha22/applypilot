import { useState } from 'react';
import type { ProfileListKey } from '../../../core/model/profile';
import { createEmptyProfile, nowIso } from '../../../core/profile/factory';
import { mergeDraftIntoProfile, type MergeResult } from '../../../core/profile/merge';
import { parseResumeText, type PersonalField, type ResumeDraft } from '../../../core/resume/parser';
import { EDUCATION_LEVEL_LABELS } from '../../../core/knowledge/education';
import { LANGUAGE_LEVEL_LABELS } from '../../../core/knowledge/languages';
import { extractResumeText } from '../../../infra/documents/extract';
import { readLinkedInExport } from '../../../infra/documents/linkedin';
import { ProvenanceBadge, repo } from '../../shared';
import { BatchImport } from '../../components/BatchImport';
import { navigate } from '../App';

const PERSONAL_LABELS: Record<PersonalField, string> = {
  fullName: 'Nome',
  headline: 'Título',
  email: 'E-mail',
  phone: 'Telefone',
  city: 'Cidade',
  state: 'Estado',
  country: 'País',
  linkedinUrl: 'LinkedIn',
  githubUrl: 'GitHub',
  portfolioUrl: 'Portfólio',
};

const MAX_PASTE = 100_000;

export function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawText, setRawText] = useState('');
  const [pasted, setPasted] = useState('');
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [selPersonal, setSelPersonal] = useState<Set<PersonalField>>(new Set());
  const [selSummary, setSelSummary] = useState(true);
  const [selPrefs, setSelPrefs] = useState(true);
  const [selItems, setSelItems] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<MergeResult | null>(null);

  const loadDraft = (text: string, source: ResumeDraft['source']) => showDraft(parseResumeText(text, source), text);

  const onLinkedInZip = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Arquivo maior que 50 MB.');
      showDraft(await readLinkedInExport(new Uint8Array(await file.arrayBuffer())), '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showDraft = (d: ResumeDraft, text: string) => {
    setRawText(text);
    setDraft(d);
    setResult(null);
    setSelPersonal(new Set(Object.keys(d.personal) as PersonalField[]));
    setSelSummary(!!d.summary);
    setSelPrefs(!!d.preferences);
    setTimeout(() => document.getElementById('resume-review')?.scrollIntoView({ behavior: 'smooth' }), 50);
    setSelItems(new Set([...d.experiences, ...d.education, ...d.skills, ...d.languages, ...d.certifications, ...d.courses].map((i) => i.id)));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { text, source } = await extractResumeText(file);
      loadDraft(text, source);
    } catch (e) {
      setDraft(null);
      setError(`${(e as Error).message} Você pode colar o texto do currículo abaixo ou cadastrar os dados manualmente no Perfil.`);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const profile = (await repo.loadProfile()) ?? createEmptyProfile();
      const items: Partial<Record<ProfileListKey, string[]>> = {};
      for (const key of ['experiences', 'education', 'skills', 'languages', 'certifications', 'courses'] as const) {
        items[key] = (draft[key] as { id: string }[]).filter((i) => selItems.has(i.id)).map((i) => i.id);
      }
      const r = mergeDraftIntoProfile(profile, draft, { personal: Array.from(selPersonal), summary: selSummary, preferences: selPrefs, items }, nowIso());
      await repo.saveProfile(r.profile);
      setResult(r);
    } catch (e) {
      setError(`Falha ao importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = (id: string) =>
    setSelItems((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Função de renderização (não componente) para não remontar os itens a cada seleção.
  const renderList = <T extends { id: string; provenance: ResumeDraft['skills'][number]['provenance'] }>(p: { title: string; items: T[]; label: (i: T) => string }) =>
    p.items.length ? (
      <div className="card compact">
        <h3>
          {p.title} ({p.items.length})
        </h3>
        {p.items.map((i) => (
          <div key={i.id} className="item">
            <label className="inline">
              <input type="checkbox" checked={selItems.has(i.id)} onChange={() => toggleItem(i.id)} />
              <span>{p.label(i)}</span>
            </label>
            <ProvenanceBadge provenance={i.provenance} />
            {i.provenance.sourceSnippet && (
              <details>
                <summary className="small muted">Trecho de origem</summary>
                <div className="snippet">{i.provenance.sourceSnippet}</div>
              </details>
            )}
          </div>
        ))}
      </div>
    ) : null;

  return (
    <div>
      <h1>Importar currículo e certificados</h1>
      <p className="muted">
        O arquivo é processado localmente, neste navegador. Os dados extraídos são apenas sugestões: você escolhe o que importar, e tudo entra no perfil como
        “Extraído de documento” até você confirmar. Dados já existentes não são sobrescritos.
      </p>

      <BatchImport onResume={(text, source) => loadDraft(text, source)} />

      <div className="card">
        <h2>LinkedIn</h2>
        <p className="small">
          O LinkedIn não permite que extensões leiam o seu perfil automaticamente (é contra os termos de uso e pode bloquear a conta). O caminho oficial é a
          exportação dos seus dados — você baixa uma vez e o ApplyPilot lê tudo:
        </p>
        <ol className="small">
          <li>
            No LinkedIn, clique em <strong>Eu</strong> → <strong>Configurações e privacidade</strong> → <strong>Privacidade de dados</strong> →{' '}
            <strong>Obter uma cópia dos seus dados</strong>.
          </li>
          <li>
            Marque <strong>Perfil</strong>, <strong>Cargos</strong>, <strong>Formação acadêmica</strong>, <strong>Competências</strong>, <strong>Certificações</strong>,{' '}
            <strong>Idiomas</strong> e <strong>Cursos</strong> (ou “Quero tudo”) e clique em <strong>Solicitar arquivo</strong>.
          </li>
          <li>O LinkedIn envia por e-mail o link do arquivo .zip (normalmente em minutos). Baixe-o.</li>
          <li>Coloque o .zip na sua pasta de certificados (ele entra junto no “Adicionar tudo”) ou escolha-o aqui:</li>
        </ol>
        <label className="btn" style={{ margin: 0 }}>
          Escolher o .zip do LinkedIn
          <input type="file" accept=".zip,application/zip" style={{ display: 'none' }} disabled={busy} onChange={(e) => onLinkedInZip(e.target.files?.[0])} />
        </label>
        <p className="small muted" style={{ marginTop: 6 }}>Só os arquivos de perfil são lidos; mensagens, conexões e outros dados do .zip são ignorados.</p>
      </div>

      <div className="card">
        <h2>Só um currículo</h2>
        <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        <p className="small muted" style={{ marginTop: 6 }}>
          Formatos: PDF (com texto selecionável), DOCX ou TXT, até 10 MB. PDFs escaneados (imagem) não são suportados.
        </p>
        <details>
          <summary>Ou cole o texto do currículo</summary>
          <textarea rows={8} value={pasted} maxLength={MAX_PASTE} onChange={(e) => setPasted(e.target.value)} placeholder="Cole aqui o conteúdo do currículo" />
          <button style={{ marginTop: 6 }} disabled={!pasted.trim()} onClick={() => loadDraft(pasted, 'resume_text')}>
            Extrair do texto colado
          </button>
        </details>
        {busy && <p>Processando…</p>}
        {error && <div className="alert bad" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {result && (
        <div className="alert ok">
          Importação concluída: {Object.values(result.added).reduce((a, b) => a + b, 0)} item(ns) adicionados
          {result.skippedDuplicates ? `, ${result.skippedDuplicates} duplicado(s) ignorado(s)` : ''}.
          {result.conflicts.length > 0 && (
            <>
              <br />
              Campos já preenchidos mantidos (não sobrescritos):
              <ul>
                {result.conflicts.map((c) => (
                  <li key={c.field}>
                    {c.field}: mantido “{c.current.slice(0, 60)}”, documento trazia “{c.incoming.slice(0, 60)}”
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => navigate('profile')}>
              Revisar e confirmar no perfil
            </button>
          </div>
        </div>
      )}

      {draft && !result && (
        <>
          <div className="card" id="resume-review">
            <div className="row between">
              <h2>Revise o que foi extraído do currículo</h2>
              <button className="primary" onClick={apply} disabled={busy}>
                Adicionar estes dados ao perfil
              </button>
            </div>
            {draft.warnings.length > 0 && (
              <div className="alert warn">
                <ul>
                  {draft.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {rawText && (
            <details>
              <summary>Texto extraído ({rawText.length} caracteres)</summary>
              <pre className="snippet" style={{ maxHeight: 300, overflow: 'auto' }}>
                {rawText}
              </pre>
            </details>
            )}
          </div>

          {Object.keys(draft.personal).length > 0 && (
            <div className="card compact">
              <h3>Dados pessoais</h3>
              <p className="small muted">Só preenchem campos vazios do seu perfil.</p>
              {(Object.keys(draft.personal) as PersonalField[]).map((k) => (
                <label key={k} className="inline" style={{ display: 'flex' }}>
                  <input
                    type="checkbox"
                    checked={selPersonal.has(k)}
                    onChange={() =>
                      setSelPersonal((s) => {
                        const n = new Set(s);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                  />
                  <strong>{PERSONAL_LABELS[k]}:</strong> {draft.personal[k]!.value}
                </label>
              ))}
            </div>
          )}
          {draft.preferences && (
            <div className="card compact">
              <label className="inline">
                <input type="checkbox" checked={selPrefs} onChange={(e) => setSelPrefs(e.target.checked)} />
                <strong>Preferências declaradas no currículo</strong>
              </label>
              <div className="snippet">{draft.preferences.snippet}</div>
              <p className="small muted">
                {[
                  draft.preferences.workModes?.length ? `Modalidades: ${draft.preferences.workModes.map((m) => ({ remote: 'remoto', hybrid: 'híbrido', onsite: 'presencial' })[m]).join(', ')}` : null,
                  draft.preferences.travelAvailability ? 'Disponível para viagens (ocasionais — ajuste se forem frequentes)' : null,
                  draft.preferences.willingToRelocate ? 'Aceita mudança de cidade' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                — só preenchem preferências ainda não declaradas.
              </p>
            </div>
          )}
          {draft.summary && (
            <div className="card compact">
              <label className="inline">
                <input type="checkbox" checked={selSummary} onChange={(e) => setSelSummary(e.target.checked)} />
                <strong>Resumo profissional</strong>
              </label>
              <div className="snippet">{draft.summary.value}</div>
            </div>
          )}
          {renderList({ title: 'Experiências', items: draft.experiences, label: (e) => `${e.title || '(cargo não identificado)'} — ${e.company || '(empresa não identificada)'} · ${e.startDate ?? '?'} a ${e.current ? 'atual' : e.endDate ?? '?'}` })}
          {renderList({ title: 'Formação', items: draft.education, label: (e) => `${EDUCATION_LEVEL_LABELS[e.level]}: ${e.degree || '?'} — ${e.institution || '?'}` })}
          {renderList({ title: 'Competências', items: draft.skills, label: (s) => s.name })}
          {renderList({ title: 'Idiomas', items: draft.languages, label: (l) => `${l.name} — ${LANGUAGE_LEVEL_LABELS[l.level]}` })}
          {renderList({ title: 'Certificações', items: draft.certifications, label: (c) => `${c.name}${c.issuer ? ` — ${c.issuer}` : ''}` })}
          {renderList({ title: 'Cursos', items: draft.courses, label: (c) => `${c.name}${c.hours ? ` (${c.hours}h)` : ''}` })}
          <button className="primary" onClick={apply} disabled={busy}>
            Adicionar estes dados ao perfil
          </button>
        </>
      )}
    </div>
  );
}
