import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import type { Profile } from '../../core/model/profile';
import type { AttachableFile, FillLog, FillPlanItem, ProfileFieldKey } from '../../core/fill/types';
import { buildFillPlan, planField } from '../../core/fill/mapper';
import { newId } from '../../core/profile/factory';
import { applyFillPlan, collectFields, type CollectedFields } from '../../infra/fill/domAdapter';
import { FillReview } from '../components/FillReview';
import { SaveAnswers } from '../components/SaveAnswers';
import { extensionUrl, repo } from '../shared';

const form = document.getElementById('demo-form') as HTMLFormElement;
// A demonstração nunca envia dados.
form.addEventListener('submit', (e) => {
  e.preventDefault();
  alert('Demonstração: nada foi enviado. O ApplyPilot nunca envia candidaturas automaticamente.');
});

function AssistPanel() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [plan, setPlan] = useState<FillPlanItem[] | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<FillLog | null>(null);
  const [resumeFile, setResumeFile] = useState<AttachableFile | null>(null);
  const collected = useRef<CollectedFields | null>(null);

  useEffect(() => {
    repo.loadProfile().then(setProfile).catch(() => setProfile(null));
    repo.loadResumeFile().then(setResumeFile);
  }, []);

  const analyze = () => {
    if (!profile) return;
    collected.current = collectFields(form);
    const p = buildFillPlan(collected.current.descriptors, profile, undefined, { resumeFile });
    setPlan(p);
    setApproved(new Set(p.filter((i) => i.selectedByDefault).map((i) => i.field.key)));
    setLog(null);
  };

  const override = (key: string, field: ProfileFieldKey | '') => {
    if (!plan || !profile) return;
    setPlan(plan.map((i) => (i.field.key === key ? planField(i.field, profile, field || undefined, undefined, { resumeFile }) : i)));
    setApproved((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  };

  const toggle = (key: string) =>
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const fill = async () => {
    if (!plan || !collected.current) return;
    const result = applyFillPlan(plan, approved, collected.current.elements, 'Formulário de demonstração', newId(), { resumeFile });
    setLog(result);
    await repo.addFillLog(result);
  };

  if (profile === undefined) return <p>Carregando…</p>;
  if (!profile) {
    return (
      <div>
        <h2>Preenchimento assistido</h2>
        <div className="alert warn">
          Nenhum perfil salvo. <a href={extensionUrl('app.html#/profile')}>Cadastre seu perfil</a> primeiro.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Preenchimento assistido</h2>
      <p className="small muted">1) Analise os campos · 2) Revise e marque o que deseja preencher · 3) Preencha. Nada é enviado.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" onClick={analyze}>
          {plan ? 'Analisar novamente' : 'Analisar formulário'}
        </button>
        {plan && (
          <button className="primary" onClick={fill} disabled={approved.size === 0}>
            Preencher {approved.size} campo(s) selecionado(s)
          </button>
        )}
      </div>

      {log && (
        <div className={`alert ${log.failed ? 'warn' : 'ok'}`}>
          {log.filled} campo(s) preenchido(s), {log.skipped} ignorado(s), {log.failed} falha(s). Revise o formulário antes de enviar. Campos preenchidos estão
          destacados em verde.
        </div>
      )}

      {plan && <FillReview plan={plan} approved={approved} onToggle={toggle} onOverride={override} />}
      {plan && <SaveAnswers key={plan.map((i) => i.field.currentValue).join('|')} plan={plan} onSaved={() => repo.loadProfile().then(setProfile)} />}
    </div>
  );
}

createRoot(document.getElementById('assist-root')!).render(
  <StrictMode>
    <AssistPanel />
  </StrictMode>,
);
