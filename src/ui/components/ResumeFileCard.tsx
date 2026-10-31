import { useEffect, useRef, useState } from 'react';
import type { AttachableFile } from '../../core/fill/types';
import { MAX_ATTACHMENT_BYTES } from '../../infra/storage/repository';
import { repo, toAttachableFile } from '../shared';

/** Arquivo do currículo guardado na extensão, anexado com a sua aprovação em campos "Currículo (arquivo)". */
export function ResumeFileCard() {
  const [file, setFile] = useState<AttachableFile | null | undefined>(undefined);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    repo.loadResumeFile().then(setFile);
  }, []);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > MAX_ATTACHMENT_BYTES) throw new Error(`O arquivo tem mais de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. Use uma versão mais leve do PDF.`);
      const att = await toAttachableFile(f);
      await repo.saveResumeFile(att);
      setFile(att);
      setMessage({ kind: 'ok', text: `"${f.name}" guardado. Ele será oferecido nos campos de currículo dos formulários.` });
    } catch (e) {
      setMessage({ kind: 'bad', text: (e as Error).message });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    await repo.removeResumeFile();
    setFile(null);
    setMessage(null);
  };

  if (file === undefined) return null;
  return (
    <div className="card">
      <h2>Arquivo do currículo (para anexar)</h2>
      <p className="small muted">
        Fica guardado só neste navegador. No preenchimento, campos como “Currículo (arquivo)” recebem este arquivo se você marcar. Nada é enviado: você
        confere e envia o formulário.
      </p>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      <div className="row">
        {file ? (
          <span>
            <strong>{file.name}</strong> <span className="small muted">· {(file.size / 1024).toFixed(0)} KB · guardado em {new Date(file.savedAt).toLocaleDateString('pt-BR')}</span>
          </span>
        ) : (
          <span className="muted">Nenhum arquivo guardado.</span>
        )}
        <span className="spacer" />
        <label className="btn" style={{ margin: 0 }}>
          {file ? 'Trocar arquivo' : 'Escolher arquivo do currículo'}
          <input ref={input} type="file" accept=".pdf,.docx,.doc" style={{ display: 'none' }} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        {file && <button onClick={remove}>Remover</button>}
      </div>
    </div>
  );
}
