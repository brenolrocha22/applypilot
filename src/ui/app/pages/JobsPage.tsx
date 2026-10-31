import { useCallback, useEffect, useState } from 'react';
import { analyzeJob } from '../../../core/fit/engine';
import { APPLICATION_STATUS_LABELS, type ApplicationStatus, type SavedJob } from '../../../core/model/job';
import { ReportView } from '../../components/ReportView';
import { formatDate, repo } from '../../shared';
import { navigate } from '../App';

export function JobsPage({ jobId }: { jobId?: string }) {
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<ApplicationStatus | ''>('');

  const reload = useCallback(() => {
    repo.listJobs().then(setJobs);
  }, []);
  useEffect(reload, [reload]);

  if (!jobs) return <p>Carregando…</p>;

  const selected = jobId ? jobs.find((j) => j.id === jobId) : undefined;

  const updateStatus = async (id: string, status: ApplicationStatus) => {
    await repo.updateJob(id, { status });
    reload();
  };

  const remove = async (job: SavedJob) => {
    if (!confirm(`Excluir a vaga "${job.input.title || 'sem título'}" e sua análise?`)) return;
    await repo.deleteJob(job.id);
    if (jobId) navigate('jobs');
    reload();
  };

  const reanalyze = async (job: SavedJob) => {
    const profile = await repo.loadProfile();
    if (!profile) {
      setMessage('Nenhum perfil salvo para reanalisar.');
      return;
    }
    const { weights } = await repo.getSettings();
    const { parsed, report } = analyzeJob(profile, job.input, { weights });
    await repo.updateJob(job.id, { parsed, report });
    setMessage('Análise atualizada com o perfil e os pesos atuais.');
    reload();
  };

  if (jobId) {
    if (!selected) {
      return (
        <div>
          <p>Vaga não encontrada.</p>
          <a href="#/jobs">Voltar</a>
        </div>
      );
    }
    return (
      <div>
        <a href="#/jobs">← Vagas salvas</a>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between">
            <div>
              <h1 style={{ marginBottom: 2 }}>{selected.input.title || 'Vaga sem título'}</h1>
              <p className="muted small">
                Salva em {formatDate(selected.createdAt)} · atualizada em {formatDate(selected.updatedAt)}
              </p>
            </div>
            <div className="row">
              <button onClick={() => reanalyze(selected)}>Reanalisar com perfil atual</button>
              <button className="danger" onClick={() => remove(selected)}>
                Excluir
              </button>
            </div>
          </div>
          <div className="grid2">
            <label>
              Status da candidatura
              <select value={selected.status} onChange={(e) => updateStatus(selected.id, e.target.value as ApplicationStatus)}>
                {(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {APPLICATION_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <NotesEditor job={selected} onSaved={reload} />
          </div>
          {message && <div className="alert ok">{message}</div>}
        </div>
        <ReportView input={selected.input} parsed={selected.parsed} report={selected.report} />
        <details className="card">
          <summary>Descrição original da vaga</summary>
          <pre className="snippet" style={{ whiteSpace: 'pre-wrap' }}>
            {selected.input.description}
          </pre>
        </details>
      </div>
    );
  }

  const visible = filter ? jobs.filter((j) => j.status === filter) : jobs;

  return (
    <div>
      <div className="row between">
        <h1>Vagas salvas</h1>
        <label className="inline">
          Filtrar:
          <select value={filter} onChange={(e) => setFilter(e.target.value as ApplicationStatus | '')} style={{ width: 'auto' }}>
            <option value="">Todas ({jobs.length})</option>
            {(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((s) => (
              <option key={s} value={s}>
                {APPLICATION_STATUS_LABELS[s]} ({jobs.filter((j) => j.status === s).length})
              </option>
            ))}
          </select>
        </label>
      </div>
      {jobs.length === 0 && (
        <div className="card">
          <p>
            Nenhuma vaga salva ainda. <a href="#/analyze">Analise uma vaga</a> e salve o resultado.
          </p>
        </div>
      )}
      {visible.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Vaga</th>
                <th>Nota</th>
                <th>Obrigatórios</th>
                <th>Alertas</th>
                <th>Status</th>
                <th>Salva em</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((j) => (
                <tr key={j.id}>
                  <td>
                    <a href={`#/jobs/${encodeURIComponent(j.id)}`}>
                      <strong>{j.input.title || 'Vaga sem título'}</strong>
                    </a>
                    <div className="small muted">{j.input.company}</div>
                  </td>
                  <td>{j.report.overallScore ?? '—'}</td>
                  <td>{j.report.counts.requiredMetPct === null ? '—' : `${j.report.counts.requiredMetPct}%`}</td>
                  <td>{j.report.blockers.length ? <span className="badge bad">{j.report.blockers.length}</span> : <span className="badge ok">0</span>}</td>
                  <td>
                    <select value={j.status} onChange={(e) => updateStatus(j.id, e.target.value as ApplicationStatus)}>
                      {(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {APPLICATION_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">{formatDate(j.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotesEditor({ job, onSaved }: { job: SavedJob; onSaved: () => void }) {
  const [notes, setNotes] = useState(job.notes);
  useEffect(() => setNotes(job.notes), [job.id, job.notes]);
  return (
    <label>
      Anotações
      <textarea rows={2} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== job.notes && repo.updateJob(job.id, { notes }).then(onSaved)} />
    </label>
  );
}
