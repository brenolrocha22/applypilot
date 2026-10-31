// Teste de fumaça E2E da extensão empacotada (dist/), sem dependências: navegador Chromium + DevTools Protocol.
// Uso: npm run build && node scripts/smoke-extension.mjs [caminho-do-navegador]
// Verifica: páginas carregam sem erros (CSP do MV3), perfil persiste em chrome.storage, análise de vaga,
// salvamento, importação de PDF real (worker do pdf.js) e preenchimento do formulário de demonstração.
//
// Atenção: o Google Chrome "branded" (137+) ignora --load-extension. Use Microsoft Edge, Chromium
// ou Chrome for Testing (o script procura Edge/Chromium automaticamente).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME =
  process.argv[2] ??
  process.env.CHROME_PATH ??
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(existsSync);
const DIST = resolve('dist');
const PORT = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (!CHROME) throw new Error('Navegador não encontrado. Informe o caminho: node scripts/smoke-extension.mjs <edge|chromium>');
if (!existsSync(join(DIST, 'manifest.json'))) throw new Error('dist/ não encontrado. Rode "npm run build" antes.');

const userDir = mkdtempSync(join(tmpdir(), 'applypilot-smoke-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
    // Chrome 137+ desativa --load-extension por padrão; esta flag reativa para testes locais.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitFor(fn, timeout = 15000, step = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* tenta novamente */
    }
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

/**
 * ID de extensão desempacotada, como o Chromium calcula: SHA-256 do caminho absoluto
 * (UTF-16LE e letra de unidade maiúscula no Windows), 16 primeiros bytes, hex mapeado para a–p.
 */
function extensionId() {
  let path = DIST;
  if (process.platform === 'win32') path = path.replace(/^[a-z]:/, (d) => d.toUpperCase());
  const bytes = Buffer.from(path, process.platform === 'win32' ? 'utf16le' : 'utf8');
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

async function openPage(fullUrl) {
  // O "#" se perderia na URL do endpoint /json/new; navegamos pelo hash depois de abrir.
  const [url, hash] = fullUrl.split('#');
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURI(url)}`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++seq;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('Log.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro de avaliação');
    return r.result?.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // SMOKE_SCREENSHOTS=<pasta> salva capturas para revisão visual.
  const screenshot = async (name) => {
    if (!process.env.SMOKE_SCREENSHOTS) return;
    mkdirSync(process.env.SMOKE_SCREENSHOTS, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(process.env.SMOKE_SCREENSHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  if (hash) {
    await waitFor(() => evaluate('document.readyState === "complete"'));
    await evaluate(`location.hash = ${JSON.stringify(`#${hash}`)}`);
  }
  return { evaluate, errors, screenshot, close: () => ws.close() };
}

/** PDF mínimo válido com texto (gerado em memória) para testar a extração real com pdf.js. */
function makePdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

const PROFILE = {
  schemaVersion: 1,
  personal: { fullName: 'Ana Exemplo da Silva', email: 'ana.exemplo@example.com', phone: '+55 11 90000-0000', city: 'São Paulo', state: 'SP', country: 'Brasil', linkedinUrl: 'https://www.linkedin.com/in/ana-exemplo', provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } },
  summary: { text: 'Desenvolvedora web.', provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } },
  experiences: [{ id: 'e1', title: 'Desenvolvedora Front-end', company: 'Empresa Fictícia A', startDate: '2020-01', current: true, description: 'Interfaces com React e TypeScript.', skills: ['React', 'TypeScript'], provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } }],
  education: [{ id: 'd1', institution: 'Universidade Fictícia', degree: 'Bacharelado em Computação', level: 'bachelor', status: 'completed', provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } }],
  skills: [{ id: 's1', name: 'React', category: 'technical', provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } }],
  languages: [{ id: 'l1', name: 'Inglês', level: 'intermediate', provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } }],
  certifications: [],
  courses: [],
  preferences: { workModes: ['remote'], provenance: { source: 'manual', status: 'confirmed', updatedAt: '2026-01-01' } },
};

const JOB = `Requisitos obrigatórios:\n- 3+ anos de experiência com React\n- TypeScript\n- Inglês fluente (obrigatório)\n\nDiferenciais:\n- Docker\n\nModelo: remoto`;

const JOB_PAGE = `<!doctype html><html><head><title>Vaga</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Analista de Dados', hiringOrganization: { name: 'Empresa Ficticia' }, description: '<p>Requisitos:</p><ul><li>Python</li><li>SQL</li><li>Excel avancado</li></ul><p>Diferenciais: Power BI</p>' }).replace(/</g, '\\u003c')}</script>
</head><body><nav>Menu do site</nav><main><h1>Analista de Dados</h1>
<form onsubmit="window.__submitted = true; return false;">
<label for="n">Nome completo</label><input id="n" name="nome">
<label>E-mail <input type="email" name="email"></label>
<label>Senha <input type="password" name="senha"></label>
<button type="submit">Enviar</button></form></main></body></html>`;

const bodyHas = (page, text) => page.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
const clickButton = (page, text) =>
  page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);

try {
  const up = await waitFor(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok));
  check('Navegador iniciou com DevTools Protocol', !!up);
  const id = extensionId();
  const base = `chrome-extension://${id}`;
  const probe = await openPage(`${base}/popup.html`);
  const loaded = await waitFor(() => probe.evaluate(`document.title === 'ApplyPilot'`), 8000);
  if (process.env.SMOKE_DEBUG) console.log('probe:', id, await probe.evaluate(`location.href + ' | ' + document.title + ' | ' + document.body?.innerText?.slice(0, 80)`).catch((e) => e.message), probe.errors);
  probe.close();
  check('Extensão carregada (manifest MV3 válido)', !!loaded, loaded ? id : 'o Chrome pode ter bloqueado --load-extension');
  if (!loaded) throw new Error('abortando');

  // 1. Páginas carregam sem erros
  for (const path of ['popup.html', 'app.html#/profile', 'app.html#/settings', 'demo-form.html']) {
    const page = await openPage(`${base}/${path}`);
    const rendered = await waitFor(() => page.evaluate(`document.body.innerText.length > 50`));
    await sleep(300);
    check(`Página ${path} renderiza sem erros`, !!rendered && page.errors.length === 0, page.errors.join(' | '));
    page.close();
  }

  // 2. Perfil persiste no chrome.storage.local
  const app = await openPage(`${base}/app.html#/profile`);
  await waitFor(() => bodyHas(app, 'Perfil profissional'));
  await app.evaluate(`chrome.storage.local.set({ 'applypilot.profile': ${JSON.stringify(PROFILE)} })`);
  await app.evaluate(`location.reload()`);
  const profileShown = await waitFor(() => app.evaluate(`[...document.querySelectorAll('input')].some(i => i.value === 'Ana Exemplo da Silva')`));
  await app.screenshot('profile');
  check('Perfil salvo é recuperado e exibido', !!profileShown);

  // 3. Análise de vaga
  await app.evaluate(`location.hash = '#/analyze'`);
  await waitFor(() => app.evaluate(`!!document.querySelector('textarea')`));
  await app.evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input'), 'Desenvolvedora Front-end');
    set(document.querySelector('textarea'), ${JSON.stringify(JOB)});
  })()`);
  await sleep(200);
  await clickButton(app, 'Analisar compatibilidade');
  const analyzed = await waitFor(() => bodyHas(app, 'Pontuação por dimensão'));
  check('Vaga analisada e relatório exibido', !!analyzed);
  check('Requisito obrigatório não atendido destacado', !!(await bodyHas(app, 'independentes da nota geral')));
  const score = await app.evaluate(`document.querySelector('.score-circle')?.textContent ?? ''`);
  check('Pontuação geral numérica', /^\d+/.test(score), score);
  await app.screenshot('report');

  // 4. Salvar vaga
  await clickButton(app, 'Salvar vaga e análise');
  check('Vaga salva', !!(await waitFor(() => bodyHas(app, 'Vaga salva'))));
  await app.evaluate(`location.hash = '#/jobs'`);
  check('Vaga aparece em "Vagas salvas"', !!(await waitFor(() => bodyHas(app, 'Desenvolvedora Front-end'))));
  await app.screenshot('jobs');
  check('Sem erros no app', app.errors.length === 0, app.errors.join(' | '));

  // 5. Importação de PDF real (worker do pdf.js sob a CSP do MV3)
  await app.evaluate(`location.hash = '#/import'`);
  await waitFor(() => app.evaluate(`!!document.querySelector('input[type=file][multiple]')`));
  if (process.env.SMOKE_DEBUG) console.log('inputs:', await app.evaluate(`[...document.querySelectorAll('input[type=file]')].map(i => i.outerHTML).join(' // ')`), app.errors);
  const pdf = makePdf(['Carlos Ficticio Souza', 'carlos@example.com', 'Habilidades', 'Python, SQL, Power BI']);
  await app.evaluate(`(() => {
    const bytes = Uint8Array.from(atob('${pdf}'), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'cv.pdf', { type: 'application/pdf' }));
    const input = document.querySelector('input[type=file][accept^=".pdf,.docx,.txt,application"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const extracted = await waitFor(() => bodyHas(app, 'Revise o que foi extraído'), 20000);
  await app.screenshot('import');
  check('PDF importado e texto extraído', !!extracted && (await bodyHas(app, 'Power BI')), app.errors.join(' | '));
  // Arquivo do currículo guardado para anexar (fictício).
  await app.evaluate(`chrome.storage.local.set({ 'applypilot.resumeFile': { name: 'Curriculo Ana.pdf', type: 'application/pdf', size: 3, base64: 'AQID', savedAt: new Date().toISOString() } })`);
  app.close();

  // 6. Formulário de demonstração
  const demo = await openPage(`${base}/demo-form.html`);
  await waitFor(() => bodyHas(demo, 'Analisar formulário'));
  await clickButton(demo, 'Analisar formulário');
  await waitFor(() => bodyHas(demo, 'Pronto para preencher'));
  await clickButton(demo, 'Preencher');
  await sleep(300);
  await demo.screenshot('demo-form');
  const values = await demo.evaluate(`({
    first: document.querySelector('[name=first_name]').value,
    email: document.querySelector('[name=email]').value,
    english: document.querySelector('[name=english]').value,
    portfolio: document.querySelector('[name=portfolio]').value,
    cpf: document.querySelector('[name=cpf]').value,
    password: document.querySelector('[name=password]').value,
    file: document.querySelector('input[type=file]')?.files?.[0]?.name ?? null,
  })`);
  check('Campos preenchidos (nome, e-mail, inglês)', values.first === 'Ana' && values.email === 'ana.exemplo@example.com' && values.english === '2', JSON.stringify(values));
  check('Valor existente não foi substituído (portfólio)', values.portfolio === 'https://meu-site-antigo.example.com');
  check('CPF e senha não foram preenchidos', values.cpf === '' && values.password === '');
  check('Arquivo do currículo anexado ao campo de arquivo', values.file === 'Curriculo Ana.pdf', JSON.stringify(values.file));
  const logs = await demo.evaluate(`chrome.storage.local.get('applypilot.fillLogs').then(r => r['applypilot.fillLogs'])`);
  check('Operação registrada sem valores pessoais', logs?.length === 1 && !JSON.stringify(logs).includes('ana.exemplo@example.com'));
  check('Sem erros no formulário de demonstração', demo.errors.length === 0, demo.errors.join(' | '));
  demo.close();

  // 7. Botão único: currículo + certificados de uma vez, com uma aba de Perfil já aberta (atualização ao vivo)
  const imp = await openPage(`${base}/app.html#/import`);
  await waitFor(() => imp.evaluate(`!!document.querySelector('input[type=file][multiple]')`));
  await imp.evaluate(`chrome.storage.local.remove('applypilot.profile')`);
  const staleProfileTab = await openPage(`${base}/app.html#/profile`);
  await waitFor(() => bodyHas(staleProfileTab, 'Dados pessoais'));
  const resumePdf = makePdf([
    'Carla Ficticia Souza',
    'carla@example.com | (11) 98888-7777 | Belo Horizonte - MG',
    'Resumo',
    'Analista com foco em dados e automacao.',
    'Experiencia',
    'Analista de Dados | Empresa Ficticia Ltda',
    'Jan 2022 - Atual',
    'Habilidades',
    'Python, SQL, Power BI',
  ]);
  const certPdf = makePdf(['Certificamos que', 'CARLA FICTICIA SOUZA', 'concluiu o curso de Excel Avancado com carga horaria de 20 horas', 'em 10 de marco de 2024']);
  await imp.evaluate(`(() => {
    const toBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([toBytes('${resumePdf}')], 'Curriculo Carla.pdf', { type: 'application/pdf' }));
    dt.items.add(new File([toBytes('${certPdf}')], 'Excel (Escola Ficticia, 2024).pdf', { type: 'application/pdf' }));
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'Modulo Python.webp', { type: 'image/webp' }));
    dt.items.add(new File(['body{}'], 'estilo.css', { type: 'text/css' }));
    const input = document.querySelector('input[type=file][multiple]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const batchOk = await waitFor(() => bodyHas(imp, 'O que será adicionado ao perfil'), 20000);
  check(
    'Importação em lote: currículo, certificado em PDF e imagem pelo nome',
    !!batchOk && (await bodyHas(imp, 'Curriculo Carla.pdf')) && (await bodyHas(imp, 'lido do documento')) && (await bodyHas(imp, 'pelo nome do arquivo')),
    imp.errors.join(' | '),
  );
  await imp.screenshot('batch');
  await clickButton(imp, 'Adicionar tudo ao perfil');
  check('Botão único adiciona currículo e certificados', !!(await waitFor(() => bodyHas(imp, 'Perfil atualizado'))) && (await bodyHas(imp, 'Dados pessoais preenchidos: nome')));
  const stored = await imp.evaluate(`chrome.storage.local.get('applypilot.profile').then(r => r['applypilot.profile'])`);
  check(
    'Perfil gravado com nome, cidade, resumo, experiência e cursos',
    stored?.personal?.fullName === 'Carla Ficticia Souza' && stored.personal.city === 'Belo Horizonte' && /foco em dados/.test(stored.summary?.text) && stored.experiences?.length === 1 && stored.courses?.length === 2,
    JSON.stringify({ nome: stored?.personal?.fullName, cidade: stored?.personal?.city, resumo: stored?.summary?.text, exp: stored?.experiences?.length, cursos: stored?.courses?.length }),
  );
  const live = await waitFor(() =>
    staleProfileTab.evaluate(`[...document.querySelectorAll('input')].some(i => i.value === 'Carla Ficticia Souza') && [...document.querySelectorAll('textarea')].some(t => t.value.includes('foco em dados'))`),
  );
  await staleProfileTab.screenshot('profile-live');
  check('Aba de perfil já aberta se atualiza sozinha', !!live);
  check('Sem erros na importação e no perfil', imp.errors.length === 0 && staleProfileTab.errors.length === 0, [...imp.errors, ...staleProfileTab.errors].join(' | '));
  imp.close();
  staleProfileTab.close();

  // 8. Agente em página web real (servida localmente): leitura da vaga e preenchimento sem envio
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(JOB_PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = await openPage(`http://127.0.0.1:${server.address().port}/vagas/123?token=segredo`);
  await waitFor(() => site.evaluate(`!!document.querySelector('form')`));
  await site.evaluate(readFileSync(join(DIST, 'content/agent.js'), 'utf8'));
  const job = await site.evaluate(`globalThis.__applypilotAgent.extractJob()`);
  check('Agente lê a vaga pelos dados estruturados', job?.source === 'structured_data' && job.title === 'Analista de Dados' && job.description.includes('Python'), JSON.stringify(job?.source));
  check('Endereço registrado sem query string', job?.url?.endsWith('/vagas/123'));
  const fields = await site.evaluate(`globalThis.__applypilotAgent.collectFields()`);
  check('Agente encontra os campos do formulário', fields?.descriptors?.length === 3, String(fields?.descriptors?.map((d) => d.label)));
  const plan = [{ field: fields.descriptors[0], profileField: 'fullName', candidates: [], value: 'Ana Exemplo', confidence: 0.85, action: 'fill', reason: '', selectedByDefault: true, requiresReview: false }];
  const log = await site.evaluate(`globalThis.__applypilotAgent.applyPlan(${JSON.stringify(plan)}, [${JSON.stringify(fields.descriptors[0].key)}], 'l1')`);
  const after = await site.evaluate(`({ nome: document.querySelector('[name=nome]').value, enviado: window.__submitted === true })`);
  check('Agente preenche o campo aprovado e não envia o formulário', log?.filled === 1 && after.nome === 'Ana Exemplo' && !after.enviado, JSON.stringify(after));
  site.close();
  server.close();
} catch (e) {
  if (e.message !== 'abortando') check('Execução sem exceções', false, e.message);
} finally {
  // Fecha o navegador pelo protocolo (mais confiável que kill no Windows).
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch {
    chrome.kill();
  }
  await sleep(500);
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* Chrome pode manter arquivos abertos por alguns instantes */
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
process.exit(failed ? 1 : 0);
