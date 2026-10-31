import type { FillAction, FillPlanItem, ProfileFieldKey } from '../../core/fill/types';
import { PROFILE_FIELD_LABELS } from '../../core/fill/mapper';

const ACTION_LABEL: Record<FillAction, [string, string]> = {
  fill: ['Pronto para preencher', 'ok'],
  same_value: ['Já preenchido', 'neutral'],
  skip_has_value: ['Já tem outro valor', 'warn'],
  ambiguous: ['Ambíguo', 'warn'],
  no_match: ['Não reconhecido', 'neutral'],
  no_profile_value: ['Sem dado no perfil', 'info'],
  blocked: ['Bloqueado', 'bad'],
};

export const isFillable = (i: FillPlanItem) => (i.action === 'fill' || i.action === 'skip_has_value') && i.value !== null;

/** Tabela de revisão do plano de preenchimento: o usuário marca o que será preenchido e pode trocar o dado usado. */
export function FillReview(props: {
  plan: FillPlanItem[];
  approved: Set<string>;
  onToggle: (key: string) => void;
  onOverride: (key: string, field: ProfileFieldKey | '') => void;
  compact?: boolean;
}) {
  const { plan, approved } = props;
  // No modo compacto (popup), campos sem ação possível ficam recolhidos.
  const visible = props.compact ? plan.filter((i) => i.action !== 'no_match' && i.action !== 'blocked') : plan;
  const hidden = plan.length - visible.length;
  return (
    <>
      <table>
        <tbody>
          {visible.map((i) => {
            const [label, cls] = ACTION_LABEL[i.action];
            const optionLabel = i.field.tag === 'select' ? i.field.options.find((o) => o.value === i.value)?.label : null;
            return (
              <tr key={i.field.key}>
                <td style={{ width: 24 }}>
                  <input
                    type="checkbox"
                    aria-label={`Preencher ${i.field.label || i.field.name}`}
                    disabled={!isFillable(i)}
                    checked={approved.has(i.field.key)}
                    onChange={() => props.onToggle(i.field.key)}
                  />
                </td>
                <td>
                  <div className="row">
                    <strong>{i.field.label || i.field.name || i.field.id || '(campo sem rótulo)'}</strong>
                    <span className={`badge ${cls}`}>{label}</span>
                    {i.requiresReview && isFillable(i) && <span className="badge warn">Revisar</span>}
                  </div>
                  {i.value !== null && (
                    <div className="small">
                      Valor: <code>{(optionLabel ?? i.value).slice(0, 120)}</code>
                      {i.action === 'skip_has_value' && (
                        <span className="muted">
                          {' '}
                          (atual: <code>{i.field.currentValue.slice(0, 60)}</code> — marque para substituir)
                        </span>
                      )}
                    </div>
                  )}
                  <div className="small muted">{i.reason}</div>
                  {i.action !== 'blocked' && (
                    <label className="small" style={{ marginTop: 4 }}>
                      Usar dado do perfil:{' '}
                      <select style={{ width: 'auto' }} value={i.profileField ?? ''} onChange={(e) => props.onOverride(i.field.key, e.target.value as ProfileFieldKey | '')}>
                        <option value="">{i.profileField ? 'Automático' : '— nenhum —'}</option>
                        {(Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[]).map((k) => (
                          <option key={k} value={k}>
                            {PROFILE_FIELD_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && <p className="small muted">{hidden} campo(s) não reconhecido(s) ou bloqueado(s) (senha, documentos, arquivos) foram omitidos.</p>}
    </>
  );
}
