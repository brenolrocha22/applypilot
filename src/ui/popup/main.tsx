import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import type { Profile } from '../../core/model/profile';
import type { FieldDescriptor, FillLog, FillPlanItem, ProfileFieldKey } from '../../core/fill/types';
import { buildFillPlan, planField } from '../../core/fill/mapper';
import { newId } from '../../core/profile/factory';
import type { ExtractedJobPage } from '../../infra/page/jobExtractor';
import type { ApplyPilotAgent } from '../../content/agent';
import { FillReview } from '../components/FillReview';
import { extensionUrl, repo } from '../shared';

function open(path: string) {
  const url = extensionUrl(path);
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank');
  window.close();
}

/** Páginas onde extensões não podem (ou não devem) executar scripts. */
function restrictionReason(url: string | undefined): string | null {
  if (!url) return 'Não foi possível identificar a página atual.';
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url)) return 'Páginas internas do navegador não podem ser lidas.';
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons/i.test(url)) return 'A loja de extensões não permite leitura por extensões.';
  if (/^file:/i.test(url)) return 'Arquivos locais exigem a opção "Permitir acesso a URLs de arquivo" nos detalhes da extensão.';
  return null;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Injeta o agente (idempotente) e executa uma função dele na aba ativa. */
async function runInTab<T>(tabId: number, fn: (...args: never[]) => T, args: unknown[] = []): Promise<T> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/agent.js'] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fn as () => T, args: args as [] });
  if (!res) throw new Error('Sem resposta da página.');
  return res.result as T;
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/Cannot access|cannot be scripted|Missing host permission/i.test(msg)) return 'O navegador não permite que a extensão leia esta página.';
  return `Falha ao acessar a página: ${msg}`;
}

type View = { kind: 'home' } | { kind: 'fill'; plan: FillPlanItem[]; page: string; tabId: number; note: string | null } | { kind: 'done'; log: FillLog };

function Popup() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [jobsCount, setJobsCount] = useState(0);
  const [tab, setTab] = useState<chrome.tabs.Tab | undefined>();
  const [view, setView] = useState<View>({ kind: 'home' });
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([repo.loadProfile(), repo.listJobs()]).then(([p, jobs]) => {
      setProfile(p);
      setJobsCount(jobs.length);
    });
    // Fora da extensão (ex.: pré-visualização no navegador) não há chrome.tabs.
    if (typeof chrome !== 'undefined' && chrome.tabs) activeTab().then(setTab);
  }, []);

  const restriction = restrictionReason(tab?.url);
  const canUsePage = !!tab?.id && !restriction && typeof chrome !== 'undefined' && 'scripting' in chrome;

  const analyzePage = async () => {
    if (!tab?.id) return;
    setBusy(true);
    setError(null);
    try {
      const job = await runInTab<ExtractedJobPage>(tab.id, () => globalThis.__applypilotAgent!.extractJob());
      if (job.description.trim().length < 80) throw new Error('Pouco texto encontrado. Selecione a descrição da vaga na página e tente novamente.');
      await repo.savePendingJob(job);
      open('app.html#/analyze');
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith('Pouco') ? e.message : friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const reviewFill = async () => {
    if (!tab?.id || !profile) return;
    setBusy(true);
    setError(null);
    try {
      const res = await runInTab<{ descriptors: FieldDescriptor[]; page: string; frameCount: number }>(tab.id, () => globalThis.__applypilotAgent!.collectFields());
      if (!res.descriptors.length) {
        setError(
          res.frameCount
            ? 'Nenhum campo encontrado. O formulário pode estar dentro de um quadro (iframe) de outro site; esta versão lê apenas a página principal.'
            : 'Nenhum campo de formulário encontrado nesta página.',
        );
        return;
      }
      const plan = buildFillPlan(res.descriptors, profile);
      setApproved(new Set(plan.filter((i) => i.selectedByDefault).map((i) => i.field.key)));
      setView({ kind: 'fill', plan, page: res.page, tabId: tab.id, note: res.frameCount ? `A página tem ${res.frameCount} quadro(s) incorporado(s) que não foram lidos.` : null });
      document.body.style.width = '560px';
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const applyFill = async () => {
    if (view.kind !== 'fill') return;
    setBusy(true);
    try {
      const log = await runInTab<FillLog>(
        view.tabId,
        ((plan: FillPlanItem[], keys: string[], id: string) => (globalThis as unknown as { __applypilotAgent: ApplyPilotAgent }).__applypilotAgent.applyPlan(plan, keys, id)) as never,
        [view.plan, Array.from(approved), newId()],
      );
      await repo.addFillLog(log);
      setView({ kind: 'done', log });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const override = (key: string, field: ProfileFieldKey | '') => {
    if (view.kind !== 'fill' || !profile) return;
    setView({ ...view, plan: view.plan.map((i) => (i.field.key === key ? planField(i.field, profile, field || undefined) : i)) });
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

  if (view.kind === 'fill') {
    return (
      <div className="popup-wrap">
        <div className="row between">
          <strong>Preencher formulário</strong>
          <button onClick={() => setView({ kind: 'home' })}>Voltar</button>
        </div>
        <p className="small muted">{view.page}</p>
        <p className="small">Marque o que deseja preencher. Nada será enviado: confira a página antes de enviar a candidatura.</p>
        {view.note && <div className="alert info small">{view.note}</div>}
        {error && <div className="alert bad small">{error}</div>}
        <button className="btn primary" disabled={busy || approved.size === 0} onClick={applyFill}>
          Preencher {approved.size} campo(s)
        </button>
        <div style={{ maxHeight: 420, overflow: 'auto', marginTop: 8 }}>
          <FillReview plan={view.plan} approved={approved} onToggle={toggle} onOverride={override} compact />
        </div>
      </div>
    );
  }

  if (view.kind === 'done') {
    const { log } = view;
    return (
      <div className="popup-wrap">
        <div className={`alert ${log.failed ? 'warn' : 'ok'}`}>
          {log.filled} campo(s) preenchido(s), {log.failed} falha(s). Revise a página antes de enviar — o ApplyPilot não envia candidaturas.
        </div>
        {log.entries
          .filter((e) => e.result === 'failed')
          .map((e) => (
            <p key={e.fieldKey} className="small">
              Falhou: {e.fieldLabel} — {e.message}
            </p>
          ))}
        <button className="btn" onClick={() => window.close()}>
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div className="popup-wrap">
      <div className="brand">
        <img src="/icons/icon48.png" alt="" /> ApplyPilot
      </div>
      <p className="small muted">
        {profile === undefined ? 'Carregando…' : profile?.personal.fullName ? `Perfil: ${profile.personal.fullName} · ${jobsCount} vaga(s) salva(s)` : 'Nenhum perfil cadastrado ainda.'}
      </p>

      <div className="card compact" style={{ marginBottom: 10 }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
          Nesta página
        </div>
        <button className="btn primary" disabled={!canUsePage || busy || !profile} onClick={analyzePage} title="Lê a descrição da vaga desta aba (ou o texto selecionado)">
          Analisar vaga desta página
        </button>
        <button className="btn" disabled={!canUsePage || busy || !profile} onClick={reviewFill} title="Identifica os campos e mostra o que será preenchido">
          Preencher formulário desta página
        </button>
        {restriction && <p className="small muted">{restriction}</p>}
        {!profile && profile !== undefined && <p className="small muted">Cadastre seu perfil para usar estas ações.</p>}
        <p className="small muted" style={{ margin: 0 }}>
          Dica: se a leitura pegar texto demais, selecione a descrição da vaga antes de clicar.
        </p>
        {error && <div className="alert bad small" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      <button className="btn" onClick={() => open('app.html#/analyze')}>
        Colar descrição de vaga
      </button>
      <button className="btn" onClick={() => open('app.html#/profile')}>
        Perfil profissional
      </button>
      <button className="btn" onClick={() => open('app.html#/import')}>
        Importar currículo e certificados
      </button>
      <button className="btn" onClick={() => open('app.html#/jobs')}>
        Vagas salvas
      </button>
      <button className="btn" onClick={() => open('demo-form.html')}>
        Formulário de demonstração
      </button>
      <p className="small muted" style={{ marginTop: 8 }}>
        A extensão só lê a aba atual quando você clica. Todos os dados ficam neste navegador.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
