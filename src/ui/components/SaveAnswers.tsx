import { useMemo, useState } from 'react';
import type { FillPlanItem } from '../../core/fill/types';
import { applyFormAnswers, learnableAnswers } from '../../core/fill/learn';
import { PROFILE_FIELD_LABELS } from '../../core/fill/mapper';
import { nowIso } from '../../core/profile/factory';
import { repo } from '../shared';

/**
 * Respostas que você digitou na página e que o seu perfil ainda não tem.
 * Marcadas por você, entram no perfil (só em campos vazios) para preencher sozinhas da próxima vez.
 */
export function SaveAnswers({ plan, onSaved }: { plan: FillPlanItem[]; onSaved?: () => void }) {
  const answers = useMemo(() => learnableAnswers(plan), [plan]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(answers.map((a) => a.fieldKey)));
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!answers.length) return null;
  if (done) return <div className="alert ok">{done}</div>;

  const save = async () => {
    try {
      const profile = await repo.loadProfile();
      if (!profile) throw new Error('Nenhum perfil salvo.');
      const { profile: next, saved } = applyFormAnswers(profile, answers.filter((a) => chosen.has(a.fieldKey)), nowIso());
      if (saved.length) await repo.saveProfile(next);
      setDone(saved.length ? `Guardado no perfil: ${saved.map((k) => PROFILE_FIELD_LABELS[k]).join(', ')}.` : 'Nada novo para guardar.');
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Guardar no perfil o que você digitou</h3>
      <p className="small muted">Estes campos estão preenchidos na página, mas o seu perfil não tem o dado. Marque o que quer guardar para não digitar de novo.</p>
      {error && <div className="alert bad">{error}</div>}
      {answers.map((a) => (
        <label key={a.fieldKey} className="row small" style={{ alignItems: 'flex-start', gap: 8 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={chosen.has(a.fieldKey)}
            onChange={() =>
              setChosen((s) => {
                const n = new Set(s);
                if (n.has(a.fieldKey)) n.delete(a.fieldKey);
                else n.add(a.fieldKey);
                return n;
              })
            }
          />
          <span>
            <strong>{PROFILE_FIELD_LABELS[a.profileField]}</strong>: <code>{a.value.length > 90 ? `${a.value.slice(0, 90)}…` : a.value}</code>
          </span>
        </label>
      ))}
      <button className="primary" disabled={chosen.size === 0} onClick={save}>
        Guardar no perfil
      </button>
    </div>
  );
}
