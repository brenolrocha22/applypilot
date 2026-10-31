import { useEffect, useState } from 'react';
import { ProfilePage } from './pages/ProfilePage';
import { ImportPage } from './pages/ImportPage';
import { AnalyzePage } from './pages/AnalyzePage';
import { JobsPage } from './pages/JobsPage';
import { FillPage } from './pages/FillPage';
import { SettingsPage } from './pages/SettingsPage';

const ROUTES = [
  { path: 'profile', label: 'Perfil profissional' },
  { path: 'import', label: 'Importar currículo' },
  { path: 'analyze', label: 'Analisar vaga' },
  { path: 'jobs', label: 'Vagas salvas' },
  { path: 'fill', label: 'Preenchimento assistido' },
  { path: 'settings', label: 'Configurações e dados' },
] as const;

/** Rota via hash: "#/jobs/<id>" → { page: 'jobs', param: '<id>' }. */
function parseHash(): { page: string; param?: string } {
  const [page, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page: page || 'profile', param: param ? decodeURIComponent(param) : undefined };
}

export function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

export function App() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const label = ROUTES.find((r) => r.path === route.page)?.label;
    document.title = label ? `${label} — ApplyPilot` : 'ApplyPilot';
    window.scrollTo(0, 0);
  }, [route.page]);

  let page;
  switch (route.page) {
    case 'import':
      page = <ImportPage />;
      break;
    case 'analyze':
      page = <AnalyzePage />;
      break;
    case 'jobs':
      page = <JobsPage jobId={route.param} />;
      break;
    case 'fill':
      page = <FillPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <ProfilePage />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icons/icon48.png" alt="" /> ApplyPilot
        </div>
        <p className="muted small">Dados armazenados somente neste navegador.</p>
        <nav className="nav" aria-label="Seções">
          {ROUTES.map((r) => (
            <a key={r.path} href={`#/${r.path}`} className={route.page === r.path ? 'active' : ''} aria-current={route.page === r.path ? 'page' : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="content">{page}</main>
    </div>
  );
}
