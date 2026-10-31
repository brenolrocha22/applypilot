import { useEffect, useRef, useState } from 'react';
import { DIMENSION_LABELS, type DimensionWeights } from '../../../core/model/fit';
import { DEFAULT_DIMENSION_WEIGHTS, DIMENSIONS, normalizeWeights, validateWeights } from '../../../core/fit/weights';
import { downloadJson, repo } from '../../shared';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function SettingsPage() {
  const [weights, setWeights] = useState<DimensionWeights | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    repo.getSettings().then((s) => setWeights(s.weights));
    repo.bytesInUse().then(setUsage);
  }, []);

  if (!weights) return <p>Carregando…</p>;

  const pct = (v: number) => Math.round(v * 1000) / 10;
  const errors = validateWeights(weights);
  const normalized = errors.length ? null : normalizeWeights(weights);

  const saveWeights = async () => {
    try {
      await repo.saveSettings({ weights: normalizeWeights(weights) });
      setWeights(normalizeWeights(weights));
      setMessage({ kind: 'ok', text: 'Pesos salvos. Novas análises usarão estes pesos; vagas salvas podem ser reanalisadas.' });
    } catch (e) {
      setMessage({ kind: 'bad', text: (e as Error).message });
    }
  };

  const exportAll = async () => {
    const bundle = await repo.exportAll();
    downloadJson(`applypilot-export-${new Date().toISOString().slice(0, 10)}.json`, bundle);
  };

  const importProfile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Arquivo maior que 5 MB.');
      const profile = repo.parseProfileImport(await file.text());
      const existing = await repo.loadProfile();
      if (existing && !confirm('Isso substituirá o perfil atual pelo perfil do arquivo. Continuar?')) return;
      await repo.saveProfile(profile);
      setMessage({ kind: 'ok', text: 'Perfil importado. Itens sem origem reconhecida ficaram como "Pendente de confirmação".' });
    } catch (e) {
      setMessage({ kind: 'bad', text: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearAll = async () => {
    if (!confirm('Excluir permanentemente o perfil, as vagas salvas, as configurações e os registros deste navegador?')) return;
    if (!confirm('Esta ação não pode ser desfeita. Recomenda-se exportar antes. Confirmar exclusão?')) return;
    await repo.clearAll();
    setWeights({ ...DEFAULT_DIMENSION_WEIGHTS });
    setUsage(await repo.bytesInUse());
    setMessage({ kind: 'ok', text: 'Todos os dados locais foram excluídos.' });
  };

  return (
    <div>
      <h1>Configurações e dados</h1>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}

      <div className="card">
        <h2>Pesos das dimensões</h2>
        <p className="small muted">
          Hipótese inicial do protótipo (a validar com uso real). Os valores são normalizados para somar 100%. Dimensões sem dados são excluídas do cálculo e
          o peso restante é redistribuído.
        </p>
        {DIMENSIONS.map((d) => (
          <div key={d} className="dim-row">
            <label htmlFor={`w-${d}`} style={{ margin: 0 }}>
              {DIMENSION_LABELS[d]}
            </label>
            <input
              id={`w-${d}`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={pct(weights[d])}
              onChange={(e) => setWeights({ ...weights, [d]: Number(e.target.value) / 100 })}
            />
            <span className="small muted">{normalized ? `${pct(normalized[d])}%` : '—'}</span>
          </div>
        ))}
        {errors.length > 0 && <div className="alert bad">{errors.join(' ')}</div>}
        <div className="row">
          <button className="primary" onClick={saveWeights} disabled={errors.length > 0}>
            Salvar pesos
          </button>
          <button onClick={() => setWeights({ ...DEFAULT_DIMENSION_WEIGHTS })}>Restaurar padrão (35/30/15/10/10)</button>
        </div>
      </div>

      <div className="card">
        <h2>Seus dados</h2>
        <p className="small muted">
          Tudo fica em <code>chrome.storage.local</code>, somente neste navegador e perfil do Chrome. Nada é enviado a servidores.
          {usage !== null && ` Espaço usado: ${(usage / 1024).toFixed(1)} KB.`}
        </p>
        <div className="row">
          <button onClick={exportAll}>Exportar tudo (JSON)</button>
          <label className="btn" style={{ margin: 0 }}>
            Importar perfil (JSON)
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => importProfile(e.target.files?.[0])} />
          </label>
          <span className="spacer" />
          <button className="danger" onClick={clearAll}>
            Excluir todos os dados locais
          </button>
        </div>
      </div>
    </div>
  );
}
