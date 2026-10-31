# Testes

## Comandos

```bash
npm test           # unitários e de integração (Vitest)
npm run typecheck  # TypeScript estrito
npm run build      # typecheck + build de produção
npm run test:e2e   # extensão real em navegador headless (após o build)
```

## Unitários e integração (Vitest)

Dados 100% fictícios em `tests/fixtures/data.ts`.

| Arquivo | Cobre |
|---|---|
| `tests/core/jobParser.test.ts` | Seções, obrigatórios × desejáveis, deduplicação, anos/idioma/formação/certificação, responsabilidades, sinais culturais, "auxílio home office", **offsets exatos do trecho original**, senioridade pelo título, idade ≠ experiência, React Native ≠ React, linhas não estruturadas, cabeçalho na mesma linha, determinismo, texto com "instruções" tratado como dado |
| `tests/core/fitEngine.test.ts` | Classificação (atendido, implicação, semelhante ⇒ parcial, ausente ⇒ não comprovado, evidência extraída ⇒ confirmação e confiança 0,8, idioma, anos, formação), fit cultural, determinismo, média ponderada, dimensão sem dados não vale zero, "Dados insuficientes para avaliar o fit cultural", preferências não declaradas, nota alta não esconde obrigatório não atendido, perfil vazio, pesos configuráveis/inválidos, contagens, experiências relevantes, sugestões de IA não contam |
| `tests/core/profile.test.ts` | Validação do perfil, coerção de dados não confiáveis, anos com sobreposição e emprego atual, parser de currículo (dados pessoais, experiências, formação, competências, idiomas, certificações, cursos, proveniência), merge sem sobrescrever e com conflitos/duplicatas |
| `tests/core/fillMapper.test.ts` (jsdom) | Prioridade de correspondência, nome × sobrenome × empresa, não sobrescrever, bloqueio de senha/CPF/CAPTCHA/arquivo, ambiguidade e resolução manual, dado sensível, dado não confirmado, `select`, adaptador DOM com formulário real (não envia, log sem valores, eventos input/change, rótulo de `select`) |
| `tests/infra/documents.test.ts` | Validação de arquivos (assinatura binária, tamanho, formatos), leitor ZIP (stored/deflate, zip bomb, arquivo inválido), DOCX → texto |
| `tests/core/certificate.test.ts` | Certificados nos formatos "Certificamos que…", "Curso de X / N horas", "Concluiu o curso de X com carga horária", inglês; diploma (formação, data de conclusão ≠ nascimento, documentos ocultos); PDF com vários certificados; dados pelo nome do arquivo/pasta; classificação; agrupamento; deduplicação; merge sem alterar formação existente |
| `tests/core/resumeLayouts.test.ts` | Currículo com títulos de letras espaçadas, "Cargo · Empresa Local datas", tópicos quebrados, rodapé de página, linha "Anteriores:", competências com rótulos de categoria, cursos "Outras:", formação + idiomas, preferências declaradas |
| `tests/infra/batchAndPage.test.ts` (jsdom) | Lote (ignora não documentos, separa currículos/certificados/outros, PDF em imagem, arquivo falso), extração de vaga da página (JSON-LD em `@graph`, seleção, conteúdo principal, JSON inválido, HTML sem execução de scripts), vaga pendente de uso único |
| `tests/infra/repository.test.ts` | Persistência de perfil, vagas (ordem, atualização, exclusão), relatório preservado, configurações, limite de logs, exportação/importação, exclusão total, adaptador `chrome.storage.local` (mock) |

Resultado da última execução (2026-10-31, v0.2.0): **9 arquivos, 113 testes, todos passando.**

## Teste de fumaça E2E (`scripts/smoke-extension.mjs`)

Sem dependências: inicia um navegador Chromium headless com a extensão de `dist/` e o controla pelo DevTools Protocol (WebSocket nativo do Node 22+). Verifica 26 itens:

- extensão carregada; popup, app, configurações e formulário de demonstração renderizam **sem erros de console** (valida a CSP do MV3);
- perfil gravado em `chrome.storage.local` é recuperado e exibido;
- análise de vaga com relatório, bloqueio destacado e nota numérica;
- salvar vaga e vê-la em "Vagas salvas";
- importação de um **PDF real** gerado em memória (valida o worker do pdf.js);
- formulário de demonstração: nome/e-mail/inglês preenchidos, portfólio existente preservado, CPF e senha intocados, log sem valores pessoais;
- importação de vários arquivos (certificado em PDF lido do texto, imagem registrada pelo nome, CSS ignorado) e inclusão no perfil;
- agente numa página web servida localmente: leitura da vaga pelo JSON-LD, URL sem query string, coleta de campos, preenchimento do campo aprovado sem enviar o formulário.

Navegador: o Google Chrome "branded" 137+ ignora `--load-extension`; o script usa Microsoft Edge ou Chromium automaticamente, ou o caminho passado como argumento (`node scripts/smoke-extension.mjs <navegador>`). Capturas opcionais: `SMOKE_SCREENSHOTS=<pasta> npm run test:e2e`.

Resultado da última execução (Edge headless, Windows, v0.2.0): **26/26 verificações passaram.**

## Calibração com documentos reais

Os leitores foram calibrados contra uma pasta real de currículos e certificados **sem copiar nenhum arquivo para o repositório**: scripts temporários fora do projeto rodam `processBatch`/`parseResumeText` e imprimem só contagens e campos. Os testes usam textos fictícios que reproduzem os layouts encontrados.

## Não coberto automaticamente

- Interação manual completa nas telas de edição do perfil (coberta parcialmente pelo E2E).
- Os botões do popup em sites reais: o clique no ícone, que concede `activeTab`, não pode ser automatizado (o agente em si é testado no E2E).
- PDFs complexos (colunas, tabelas) e DOCX com caixas de texto.
- Carregamento no Google Chrome branded (validado no Edge, mesmo motor Chromium; carregue manualmente via `chrome://extensions` para conferir).
