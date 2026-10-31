# Arquitetura

## Visão geral

```
┌───────────────────────── Extensão (MV3) ─────────────────────────┐
│ popup.html (ações na aba atual)  app.html (perfil, importação, análise,  demo-form.html
│  (atalhos)       relatório, vagas, preenchimento, config.)  (formulário + painel)
│      │                 │                                       │
│      └──────── src/ui (React) ─────────────────────────────────┘
│                        │
│        src/infra  ── storage (chrome.storage.local), documents (PDF/DOCX/ZIP, lote),
│                        │       fill/domAdapter (DOM ↔ plano), page/jobExtractor
│        src/content/agent.ts ── IIFE injetado sob demanda na aba ativa (activeTab + scripting)
│                        │
│        src/core   ── funções puras, sem DOM e sem chrome.*:
│                      model · knowledge · profile · resume · job · fit · fill
└──────────────────────────────────────────────────────────────────┘
```

Regra de dependência: `ui → infra → core`. O `core` não importa nada de `infra` ou `ui` (exceção: tipos). Isso permite testar o motor no Node, reutilizá-lo num content script e, futuramente, num backend.

## Módulos do core

| Módulo | Responsabilidade |
|---|---|
| `model/` | Tipos: perfil, proveniência, vaga, requisitos, relatório |
| `knowledge/` | Normalização de texto, dicionário de competências (aliases, `implies`, `related`), idiomas, formação |
| `profile/` | Fábrica, validação semântica, coerção estrutural de dados externos, cálculo de anos, merge de importação |
| `resume/` | Texto de currículo → rascunho com proveniência (letras espaçadas, linhas quebradas, preferências declaradas); `certificate.ts`: certificados/diplomas → rascunhos, classificação de documentos, dados pelo nome do arquivo, agrupamento por pasta |
| `job/` | Descrição de vaga → `ParsedJob` (requisitos com trecho original) |
| `fit/` | Índice de evidências do perfil, avaliadores por tipo, agregação, recomendação |
| `fill/` | Catálogo de campos, mapeamento campo→perfil, plano de preenchimento |

## Decisões

| Decisão | Motivo |
|---|---|
| Importação de pasta via `<input webkitdirectory>` | Funciona em páginas de extensão sem permissão extra; o usuário escolhe a pasta a cada importação. Arquivos não são guardados. |
| Certificados em imagem registrados pelo nome do arquivo | 40 de 53 PDFs da pasta real testada eram imagem; sem OCR, nome do arquivo/pasta é a melhor fonte — com estado "pendente". |
| Agente em build separado (IIFE) | `executeScript({files})` exige script clássico autocontido; ver `vite.content.config.ts`. |
| Regras determinísticas, sem IA | Requisito do MVP (sem serviço pago/externo); resultado reprodutível e explicável. A IA pode ser adicionada depois como fonte de *sugestões* (`ai_suggested`), que não contam como evidência. |
| Página de app em aba (`options_page`) em vez de popup complexo | Relatórios e formulários longos não cabem num popup. O popup só tem atalhos. |
| `chrome.storage.local` (sem IndexedDB) | Volume pequeno (perfil + algumas centenas de vagas). O arquivo do currículo **não** é guardado — só o texto extraído durante a importação, e apenas os trechos de origem por item. |
| Leitor ZIP próprio para DOCX | Evita dependência (`mammoth`/`jszip`); usa `DecompressionStream` nativo. Limite de 20 MB descompactados contra zip bombs. |
| `pdfjs-dist` carregado sob demanda | Única dependência pesada; carregada só na importação. Worker empacotado localmente (`.js`), `isEvalSupported: false`. |
| Versões fixas (React 18.3, Vite 5.4, Vitest 2.1, TS 5.6) | Estáveis e conhecidas; majors recentes (TS 7, Vite 8) não trazem benefício ao MVP. |
| Sem Playwright | Evita download de navegadores; o teste E2E usa o DevTools Protocol direto (`scripts/smoke-extension.mjs`). |
| IDs determinísticos de requisitos (`req-N`) e `referenceDate`/`now` injetáveis | Mesma entrada ⇒ mesmo relatório (testado). |
| Adaptador de armazenamento (`KeyValueStore`) | Troca futura por backend/sincronização sem alterar o core. |

## Segurança e privacidade

- **Permissões:** `storage`, `activeTab` e `scripting`. Sem `host_permissions` e sem content scripts declarados: o agente (`dist/content/agent.js`, ~5 KB) só é injetado na aba ativa depois do clique do usuário, roda no *isolated world* (scripts da página não o acessam), não faz requisições, não envia formulários e não lê senhas. Formulários em iframes de outros domínios não são lidos (exigiriam permissão de host).
- **Página lida:** prioridade para o texto selecionado; depois JSON-LD `JobPosting` (HTML convertido em texto via `DOMParser`, que não executa scripts); depois `main/article`; por último a página inteira (avisado na tela). O endereço registrado omite query string e fragmento.
- **CSP:** `script-src 'self'; object-src 'self'`. Nenhum script remoto; nenhum `eval`.
- **Dados externos não confiáveis:** descrições de vaga, currículos e JSON importado são tratados como dados. Texto nunca é executado nem interpretado como instrução (há teste com "instrução maliciosa" na vaga). JSON importado passa por coerção campo a campo (`coerceProfile`), descartando chaves desconhecidas e normalizando enums; proveniência desconhecida vira "Pendente".
- **Arquivos:** validação de extensão + assinatura binária + tamanho; `.doc` recusado; DOCX lido por regex sobre o XML (macros/objetos ignorados); PDF sem eval e sem XFA.
- **Renderização:** React escapa todo texto; não há `dangerouslySetInnerHTML`. Links da vaga abrem com `rel="noopener noreferrer"` e só aceitam `http(s)`.
- **Preenchimento:** nunca envia formulário, não clica em botões, não interage com CAPTCHA, não preenche senha/CPF/RG/cartão/token, não substitui valores existentes sem aprovação. O log não grava valores. O valor de campos de senha nem é lido. Campos de arquivo só recebem o currículo guardado pelo usuário (via `DataTransfer`, igual a escolher o arquivo), com aprovação.
- **Respostas digitadas → perfil:** só campos reconhecidos, vazios no perfil, de texto, não bloqueados, e só os que o usuário marcar.
- **Cofre:** WebCrypto (AES-256-GCM + PBKDF2-SHA-256, 600 mil iterações, sal de 16 bytes, IV de 12 bytes aleatórios). A senha nunca é armazenada nem enviada; perdê-la torna o arquivo ilegível.
- **LinkedIn:** além da exportação oficial (.zip), lê a página de competências do próprio perfil quando o usuário a abre e clica no botão (activeTab). Não há navegação, rolagem ou cliques automáticos nem leitura de outras páginas. Os termos do LinkedIn restringem ferramentas automatizadas: o uso é por conta e escolha do usuário.
- **Logs:** o código não registra dados pessoais no console.
- **Exclusão:** "Excluir todos os dados locais" remove todas as chaves; desinstalar também remove.

### Limites e riscos conhecidos

- `chrome.storage.local` tem cota de ~10 MB; o app limita 300 vagas salvas e 30 registros de preenchimento.
- Os dados no navegador **não são criptografados** em repouso: qualquer pessoa/processo com acesso ao perfil do sistema operacional e do navegador pode lê-los. O cofre protege a **cópia** (arquivo), não o armazenamento interno.
- Desinstalar a extensão apaga os dados sem confirmação extra do Chrome — exporte backups.
- Outras extensões não têm acesso ao storage desta extensão, mas malware local tem.

## Evolução prevista

1. **Páginas reais:** implementado na 0.2 (`activeTab` + `scripting`). Próximo: iframes de ATS (Greenhouse, Lever etc.), que exigiriam permissões de host específicas.
2. **IA opcional:** provedor plugável que gera itens `ai_suggested`/rascunhos; nunca altera dados confirmados nem a pontuação diretamente.
3. **SaaS:** implementar `KeyValueStore` remoto + autenticação; o core já é independente de plataforma.
