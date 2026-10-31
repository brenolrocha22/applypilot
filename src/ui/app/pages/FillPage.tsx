import { useEffect, useState } from 'react';
import type { FillLog } from '../../../core/fill/types';
import { PROFILE_FIELD_LABELS } from '../../../core/fill/mapper';
import { extensionUrl, repo } from '../../shared';

export function FillPage() {
  const [logs, setLogs] = useState<FillLog[]>([]);
  useEffect(() => {
    repo.listFillLogs().then(setLogs);
  }, []);

  return (
    <div>
      <h1>Preenchimento assistido</h1>
      <div className="card">
        <p>
          Nesta versão, o preenchimento funciona no <strong>formulário de demonstração local</strong>. O ApplyPilot identifica os campos, propõe valores do seu
          perfil e só preenche o que você aprovar. Ele nunca envia o formulário, não preenche senhas, documentos (CPF) ou CAPTCHAs, e não substitui valores
          existentes sem sua escolha explícita.
        </p>
        <a className="btn primary" href={extensionUrl('demo-form.html')} target="_blank" rel="noopener">
          Abrir formulário de demonstração
        </a>
      </div>

      <div className="card">
        <h2>Registro das últimas operações</h2>
        <p className="small muted">Por privacidade, o registro guarda apenas os campos e o resultado — não os valores preenchidos.</p>
        {logs.length === 0 && <p className="muted">Nenhuma operação registrada.</p>}
        {logs.map((log) => (
          <details key={log.id} className="item">
            <summary>
              {new Date(log.timestamp).toLocaleString('pt-BR')} · {log.page} · {log.filled} preenchido(s), {log.skipped} ignorado(s), {log.failed} falha(s)
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Propriedade do perfil</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {log.entries.map((e) => (
                  <tr key={e.fieldKey}>
                    <td>{e.fieldLabel || e.fieldKey}</td>
                    <td>{e.profileField ? PROFILE_FIELD_LABELS[e.profileField] : '—'}</td>
                    <td>
                      <span className={`badge ${e.result === 'filled' ? 'ok' : e.result === 'failed' ? 'bad' : 'neutral'}`}>
                        {e.result === 'filled' ? 'Preenchido' : e.result === 'failed' ? 'Falhou' : 'Ignorado'}
                      </span>{' '}
                      <span className="small muted">{e.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </div>
  );
}
