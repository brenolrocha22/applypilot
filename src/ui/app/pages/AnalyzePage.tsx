import { useEffect, useState } from 'react';
import { analyzeJob } from '../../../core/fit/engine';
import { MAX_DESCRIPTION_LENGTH } from '../../../core/job/parser';
import type { FitReport, DimensionWeights } from '../../../core/model/fit';
import type { JobInput, ParsedJob, SavedJob } from '../../../core/model/job';
import type { Profile } from '../../../core/model/profile';
import { newId, nowIso } from '../../../core/profile/factory';
import { ReportView } from '../../components/ReportView';
import { repo } from '../../shared';
import { navigate } from '../App';
import type { JobPageSource } from '../../../infra/page/jobExtractor';

const EMPTY_INPUT: JobInput = { title: '', company: '', sourceUrl: '', description: '' };
const SOURCE_LABEL: Record<JobPageSource, string> = {
  selection: 'texto que você selecionou',
  structured_data: 'dados estruturados da vaga publicados pelo site',
  main_content: 'conteúdo principal da página',
  page_body: 'página inteira — pode conter menus e textos que não são da vaga',
};

export function AnalyzePage() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [weights, setWeights] = useState<DimensionWeights | null>(null);
  const [input, setInput] = useState<JobInput>(EMPTY_INPUT);
  const [result, setResult] = useState<{ input: JobInput; parsed: ParsedJob; report: FitReport } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);

  useEffect(() => {
    // Vaga capturada pelo popup ("Analisar vaga desta página"): preenche o formulário e analisa.
    Promise.all([repo.loadProfile().catch(() => null), repo.getSettings(), repo.takePendingJob()]).then(([p, s, pending]) => {
      setProfile(p);
      setWeights(s.weights);
      if (!pending) return;
      const captureInput: JobInput = { title: pending.title, company: pending.company, sourceUrl: pending.url, description: pending.description };
      setInput(captureInput);
      setCaptured(
        `Texto capturado de ${pending.url} (${SOURCE_LABEL[pending.source]})${pending.truncated ? ', truncado' : ''}. Confira se a descrição está correta; você pode editá-la e analisar novamente.`,
      );
      if (p) {
        const { parsed, report } = analyzeJob(p, captureInput, { weights: s.weights });
        setResult({ input: captureInput, parsed, report });
      }
    });
  }, []);

  const set = (k: keyof JobInput) => (e: { target: { value: string } }) => setInput((i) => ({ ...i, [k]: e.target.value }));
  const urlInvalid = input.sourceUrl !== '' && !/^https?:\/\//i.test(input.sourceUrl);

  const analyze = () => {
    if (!profile) return;
    setError(null);
    try {
      const { parsed, report } = analyzeJob(profile, input, { weights: weights ?? undefined });
      setResult({ input: { ...input }, parsed, report });
      setSavedId(null);
    } catch (e) {
      setError(`Falha na análise: ${(e as Error).message}`);
    }
  };

  const save = async () => {
    if (!result) return;
    const now = nowIso();
    const job: SavedJob = { id: newId(), input: result.input, parsed: result.parsed, report: result.report, status: 'analyzed', notes: '', createdAt: now, updatedAt: now };
    try {
      await repo.saveJob(job);
      setSavedId(job.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (profile === undefined) return <p>Carregando…</p>;

  return (
    <div>
      <h1>Analisar vaga</h1>
      {captured && <div className="alert info">{captured}</div>}
      {!profile && (
        <div className="alert warn">
          Você ainda não tem um perfil salvo. <a href="#/profile">Cadastre seu perfil</a> ou <a href="#/import">importe seu currículo</a> antes de analisar vagas.
        </div>
      )}
      <div className="card">
        <div className="grid2">
          <label>
            Título do cargo
            <input value={input.title} onChange={set('title')} maxLength={200} placeholder="Ex.: Pessoa Desenvolvedora Front-end Pleno" />
          </label>
          <label>
            Empresa
            <input value={input.company} onChange={set('company')} maxLength={200} />
          </label>
        </div>
        <label>
          Link da vaga (opcional)
          <input type="url" value={input.sourceUrl} onChange={set('sourceUrl')} maxLength={1000} placeholder="https://…" />
        </label>
        {urlInvalid && <p className="small" style={{ color: 'var(--bad)' }}>O link deve começar com http:// ou https://.</p>}
        <label>
          Descrição da vaga
          <textarea rows={14} value={input.description} onChange={set('description')} maxLength={MAX_DESCRIPTION_LENGTH} placeholder="Cole aqui a descrição completa da vaga, incluindo requisitos e diferenciais." />
        </label>
        <p className="small muted">
          O texto é analisado localmente por regras. Ele é tratado apenas como dado: instruções contidas na descrição não alteram a análise.
        </p>
        <div className="row">
          <button className="primary" onClick={analyze} disabled={!profile || !input.description.trim() || urlInvalid}>
            Analisar compatibilidade
          </button>
          {result && (
            <button
              onClick={() => {
                setInput(EMPTY_INPUT);
                setResult(null);
              }}
            >
              Nova análise
            </button>
          )}
        </div>
        {error && <div className="alert bad" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {result && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            {savedId ? (
              <>
                <span className="badge ok">Vaga salva</span>
                <button onClick={() => navigate(`jobs/${savedId}`)}>Abrir em vagas salvas</button>
              </>
            ) : (
              <button className="primary" onClick={save}>
                Salvar vaga e análise
              </button>
            )}
          </div>
          {result.parsed.warnings.length > 0 && (
            <div className="alert warn">
              <ul>
                {result.parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <ReportView {...result} />
        </>
      )}
    </div>
  );
}
