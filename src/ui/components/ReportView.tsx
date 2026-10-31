import type { FitReport, RequirementAssessment } from '../../core/model/fit';
import { DIMENSION_LABELS } from '../../core/model/fit';
import type { JobInput, ParsedJob } from '../../core/model/job';
import { ImportanceBadge, StatusBadge } from '../shared';

/** Relatório de compatibilidade: cada conclusão mostra requisito, evidência, justificativa e incerteza. */
export function ReportView({ input, parsed, report }: { input: JobInput; parsed: ParsedJob; report: FitReport }) {
  const all = report.dimensions.flatMap((d) => d.assessments);
  const matchedSkills = all.filter((a) => a.requirement.kind === 'skill' && a.status === 'met');
  const partial = all.filter((a) => a.status === 'partially_met');
  const gaps = all.filter((a) => (a.status === 'not_proven' || a.status === 'not_met') && a.requirement.dimension !== 'culture');
  const required = all.filter((a) => a.requirement.importance === 'required' || a.requirement.eliminatory);
  const culture = report.dimensions.find((d) => d.dimension === 'culture')!;
  const c = report.counts;
  const rec = report.recommendation;
  const recClass = rec.level === 'review_blockers' ? 'bad' : rec.level === 'strong' ? 'ok' : rec.level === 'insufficient_data' ? 'info' : 'warn';

  return (
    <div>
      <div className="card">
        <div className="score-hero">
          <div className="score-circle" aria-label={`Compatibilidade geral ${report.overallScore ?? 'indisponível'} de 100`}>
            <div>
              {report.overallScore ?? '—'}
              <small>de 100</small>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ marginBottom: 2 }}>{input.title || 'Vaga sem título'}</h2>
            <p className="muted">
              {input.company || 'Empresa não informada'}
              {input.sourceUrl && (
                <>
                  {' · '}
                  <a href={input.sourceUrl} target="_blank" rel="noopener noreferrer">
                    link da vaga
                  </a>
                </>
              )}
            </p>
            <p className="small muted">Compatibilidade com os requisitos identificados. Não é probabilidade de contratação.</p>
          </div>
        </div>
        <div className="metrics">
          <Metric value={c.requiredMetPct === null ? '—' : `${c.requiredMetPct}%`} label={`Obrigatórios comprovadamente atendidos (${c.requiredMet}/${c.requiredTotal})`} />
          <Metric value={`${c.preferredMet}/${c.preferredTotal}`} label="Desejáveis atendidos" />
          <Metric value={String(c.partiallyMet)} label="Parcialmente atendidos" />
          <Metric value={String(c.notProven)} label="Não comprovados" />
          <Metric value={String(c.notMet)} label="Não atendidos" />
          <Metric value={`${Math.round(report.coverage * 100)}%`} label="Cobertura da análise (peso das dimensões avaliadas)" />
        </div>
      </div>

      {report.blockers.length > 0 && (
        <div className="alert bad">
          <strong>Requisitos obrigatórios que exigem atenção ({report.blockers.length}) — independentes da nota geral:</strong>
          {report.blockers.map((a) => (
            <AssessmentRow key={a.requirement.id} a={a} />
          ))}
        </div>
      )}

      <div className={`alert ${recClass}`}>
        <strong>Recomendação: {rec.headline}</strong>
        <ul>
          {rec.explanation.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Pontuação por dimensão</h2>
        {report.dimensions.map((d) => (
          <div key={d.dimension}>
            <div className="dim-row">
              <span>
                {DIMENSION_LABELS[d.dimension]} <span className="small muted">({Math.round(d.weight * 100)}%)</span>
              </span>
              <div className="bar" aria-hidden>
                <span style={{ width: `${d.score ?? 0}%`, opacity: d.evaluable ? 1 : 0 }} />
              </div>
              <strong>{d.evaluable ? d.score : 'n/a'}</strong>
            </div>
            {d.note && <p className="small muted" style={{ marginTop: -4 }}>{d.note}</p>}
          </div>
        ))}
      </div>

      <AssessmentGroup title="Requisitos obrigatórios" items={required} empty="A vaga não separa explicitamente requisitos obrigatórios." open />
      <AssessmentGroup title="Competências correspondentes" items={matchedSkills} empty="Nenhuma competência correspondente encontrada." />

      <div className="card">
        <h2>Experiências profissionais relevantes</h2>
        {report.relevantExperiences.length === 0 && <p className="muted">Nenhuma experiência do perfil corresponde aos requisitos identificados.</p>}
        {report.relevantExperiences.map((e) => (
          <div key={e.experienceId} className="req">
            <div className="title">
              {e.title}
              {e.company && ` — ${e.company}`}
            </div>
            {e.matchedTerms.length > 0 && <div className="small">Competências da vaga presentes: {e.matchedTerms.join(', ')}</div>}
            {e.responsibilityMatches.map((r, i) => (
              <blockquote key={i} className="source">
                Responsabilidade semelhante: {r.text}
              </blockquote>
            ))}
          </div>
        ))}
      </div>

      <AssessmentGroup title="Requisitos parcialmente atendidos" items={partial} empty="Nenhum." />
      <AssessmentGroup title="Lacunas identificadas" items={gaps} empty="Nenhuma lacuna identificada." description="“Não comprovado” significa que o perfil não traz evidência — não que você não tenha a competência." />
      <AssessmentGroup title="Informações que precisam de confirmação" items={report.needsConfirmation} empty="Todas as evidências usadas estão confirmadas." />

      <div className="card">
        <h2>Avaliação cultural</h2>
        {culture.evaluable ? (
          <>
            <p>
              Fit cultural: <strong>{culture.score}/100</strong> — compara somente características descritas na vaga com preferências que você declarou.
            </p>
            {culture.assessments.map((a) => (
              <AssessmentRow key={a.requirement.id} a={a} />
            ))}
          </>
        ) : (
          <p>{culture.note ?? 'Dados insuficientes para avaliar o fit cultural.'}</p>
        )}
      </div>

      <div className="card">
        <h2>Próximas ações sugeridas</h2>
        {rec.nextActions.length ? (
          <ul>
            {rec.nextActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nenhuma ação adicional.</p>
        )}
      </div>

      <details className="card">
        <summary>Todos os requisitos identificados ({all.length}) e limitações da análise</summary>
        <ul className="small">
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {report.dimensions.map((d) => (
          <div key={d.dimension}>
            <h3 style={{ marginTop: 12 }}>{DIMENSION_LABELS[d.dimension]}</h3>
            {d.assessments.length === 0 && <p className="small muted">Nenhum requisito.</p>}
            {d.assessments.map((a) => (
              <AssessmentRow key={a.requirement.id} a={a} />
            ))}
          </div>
        ))}
        {parsed.unstructuredLines.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Linhas de requisitos não estruturadas</h3>
            {parsed.unstructuredLines.map((s, i) => (
              <blockquote key={i} className="source">
                {s.text}
              </blockquote>
            ))}
          </>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          Motor {report.engineVersion} · data de referência {report.referenceDate.slice(0, 10)}
        </p>
      </details>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function AssessmentGroup(props: { title: string; items: RequirementAssessment[]; empty: string; description?: string; open?: boolean }) {
  return (
    <details className="card" open={props.open || props.items.length <= 6}>
      <summary>
        {props.title} ({props.items.length})
      </summary>
      {props.description && <p className="small muted">{props.description}</p>}
      {props.items.length === 0 && <p className="muted">{props.empty}</p>}
      {props.items.map((a) => (
        <AssessmentRow key={a.requirement.id} a={a} />
      ))}
    </details>
  );
}

export function AssessmentRow({ a }: { a: RequirementAssessment }) {
  const r = a.requirement;
  return (
    <div className="req">
      <div className="row">
        <span className="title">{r.label}</span>
        <StatusBadge status={a.status} />
        <ImportanceBadge importance={r.importance} eliminatory={r.eliminatory} />
      </div>
      <div className="small">{a.justification}</div>
      {a.evidence.length > 0 && (
        <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>
          {a.evidence.map((e, i) => (
            <li key={i}>
              Evidência: {e.description}
              {e.validationStatus !== 'confirmed' && <span className="badge warn" style={{ marginLeft: 6 }}>não confirmada</span>}
              {e.snippet && <div className="snippet">{e.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
      {a.uncertainty && <div className="small muted">Incerteza: {a.uncertainty}</div>}
      <blockquote className="source" title="Trecho original da vaga">
        {r.source.start >= 0 ? `Vaga: “${r.source.text}”` : r.source.text}
      </blockquote>
    </div>
  );
}
