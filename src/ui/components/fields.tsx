import type { ReactNode } from 'react';

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label>
      {props.label}
      <input type={props.type ?? 'text'} value={props.value} placeholder={props.placeholder} maxLength={props.maxLength ?? 500} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; maxLength?: number }) {
  return (
    <label>
      {props.label}
      <textarea rows={props.rows ?? 3} value={props.value} placeholder={props.placeholder} maxLength={props.maxLength ?? 5000} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T | null | undefined;
  options: Record<T, string>;
  onChange: (v: T | null) => void;
  allowEmpty?: string;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value === '' ? null : (e.target.value as T))}>
        {props.allowEmpty !== undefined && <option value="">{props.allowEmpty}</option>}
        {(Object.keys(props.options) as T[]).map((k) => (
          <option key={k} value={k}>
            {props.options[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Mês/ano no formato AAAA-MM (input nativo "month"). */
export function MonthField(props: { label: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  // Datas só com ano ("2019") são exibidas como janeiro para edição.
  const v = props.value && /^\d{4}$/.test(props.value) ? `${props.value}-01` : (props.value ?? '');
  return (
    <label>
      {props.label}
      <input type="month" value={v} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value || null)} />
    </label>
  );
}

export function CheckboxGroup<T extends string>(props: { legend: string; options: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 500, marginBottom: 4 }}>{props.legend}</div>
      {(Object.keys(props.options) as T[]).map((k) => (
        <label key={k} className="inline">
          <input
            type="checkbox"
            checked={props.value.includes(k)}
            onChange={(e) => props.onChange(e.target.checked ? [...props.value, k] : props.value.filter((x) => x !== k))}
          />
          {props.options[k]}
        </label>
      ))}
    </div>
  );
}

export function Section(props: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <div>
          <h2>{props.title}</h2>
          {props.description && <p className="muted small">{props.description}</p>}
        </div>
        <div className="row">{props.actions}</div>
      </div>
      {props.children}
    </section>
  );
}
