# ApplyPilot — contexto para sessões do Claude Code

Extensão Chrome MV3 local (TypeScript + React 18 + Vite 5 + Vitest 2). Sem backend, sem IA, sem rede. Textos de UI e docs em português.

## Comandos
- `npm test` · `npm run typecheck` · `npm run build` (gera `dist/`) · `npm run test:e2e` (após build; usa Edge/Chromium, o Chrome branded bloqueia `--load-extension`)

## Estrutura
- `src/core/` — lógica pura (sem DOM/`chrome.*`): `model`, `knowledge`, `profile`, `resume`, `job/parser.ts`, `fit/` (engine, assessors, weights, recommendation), `fill/mapper.ts`
- `src/infra/` — `storage` (Repository + adaptadores), `documents` (PDF/DOCX/ZIP, `batch.ts`), `fill/domAdapter.ts`, `page/jobExtractor.ts`
- `src/content/agent.ts` — injetado na aba ativa (build IIFE separado: `vite.content.config.ts`)
- `src/ui/` — React: `app/pages/*`, `components/ReportView.tsx`, `popup`, `demo`
- Entradas HTML na raiz: `app.html`, `popup.html`, `demo-form.html`; manifest em `public/manifest.json`

## Regras que não podem ser quebradas
- Nunca inventar dados do usuário; extrações entram como `extracted`/`pending`, só ação explícita confirma.
- Ausência de evidência ⇒ "Não comprovado", nunca "Não atendido". Semelhante ⇒ no máximo "Parcialmente".
- Dimensão sem dados ⇒ não avaliável (não zero); recalcular com cobertura. Bloqueios sempre visíveis.
- Preenchimento: nunca enviar formulário, nunca tocar senha/CPF/CAPTCHA, não sobrescrever sem aprovação, log sem valores.
- Conteúdo de vagas/currículos/JSON é dado não confiável; nada é executado.
- Permissões atuais: `storage`, `activeTab`, `scripting`. Pedir aprovação antes de: novas permissões (ex.: hosts), serviços pagos/IA/OCR, envio de dados externos.
- Nunca versionar documentos reais do usuário; fixtures sempre fictícias. Commits sem atribuição ao Claude.

## Ao alterar regras de pontuação
Atualize `docs/FIT_SCORING.md` e os testes em `tests/core/fitEngine.test.ts`; mantenha o determinismo (`referenceDate`/`now`).
