# ApplyPilot

Extensão para Chrome (Manifest V3) que ajuda a gerenciar o perfil profissional, analisar a compatibilidade com vagas de forma explicável e preencher formulários de candidatura com revisão. **Tudo roda localmente**: sem backend, sem contas, sem envio de dados a terceiros e sem IA paga.

> Versão 0.2.0 — protótipo para uso pessoal.

## O que funciona

| Área | Situação |
|---|---|
| Perfil profissional (dados pessoais, resumo, experiências, formação, competências, idiomas, certificações, cursos, preferências) | Cadastro, edição, exclusão, validação, confirmação item a item |
| Origem e estado de cada informação | Confirmado / Extraído de documento / Sugerido pela IA / Pendente |
| Importação de currículo | PDF (texto selecionável), DOCX, TXT ou texto colado → rascunho revisável, sem sobrescrever dados existentes |
| Importação de pasta | Currículos + certificados + diplomas de uma pasta inteira; certificados em imagem registrados pelo nome do arquivo (pendentes); módulos de bootcamp agrupáveis |
| Vaga da página aberta | Botão no popup lê a vaga da aba atual (dados estruturados do site, texto selecionado ou conteúdo principal) |
| Preenchimento em sites | Botão no popup lê os campos da aba atual, mostra o plano e preenche só o que você marcar |
| Análise de vaga | Texto colado ou capturado da página; extração de requisitos com referência ao trecho original |
| Motor de fit | 5 dimensões, pesos configuráveis, cobertura, bloqueios independentes da nota |
| Relatório | Nota, dimensões, obrigatórios, evidências, lacunas, itens a confirmar, fit cultural, recomendação e próximas ações |
| Vagas salvas | Lista, status da candidatura, anotações, reanálise, exclusão |
| Preenchimento assistido | Formulário de demonstração local, plano revisável, registro sem valores pessoais |
| Dados | Exportar (JSON), importar perfil (JSON), excluir tudo |

Ainda **não** implementado: geração de versões direcionadas do currículo, leitura de texto em imagens (OCR), formulários dentro de iframes de outros domínios, integração específica com LinkedIn, IA. Ver [CHANGELOG.md](CHANGELOG.md).

## Instalação

Requisitos: Node.js 18+ (testado com Node 24) e Google Chrome (ou Edge).

```bash
npm install
npm run build
```

No Chrome:

1. Acesse `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `dist/`.
4. Fixe o ícone do ApplyPilot na barra de ferramentas.

Após alterar o código, rode `npm run build` (ou `npm run dev` para rebuild contínuo) e clique em **Recarregar** no card da extensão.

## Como usar

1. **Perfil**: clique no ícone → *Importar currículo e certificados* → **Escolher pasta** (a pasta onde você guarda currículo e certificados). Escolha o currículo, revise os certificados e adicione. Itens importados aparecem com borda amarela no perfil até você clicar em **Confirmar**.
2. **Analisar vaga**: abra a vaga no navegador → ícone do ApplyPilot → **Analisar vaga desta página**. Se a leitura pegar texto demais, selecione a descrição da vaga antes de clicar. Também é possível colar a descrição manualmente.
3. **Relatório**: confira a nota, os requisitos obrigatórios destacados (independentes da nota), as evidências e o trecho original de cada requisito. **Salvar vaga e análise** guarda o resultado.
4. **Vagas salvas**: acompanhe o status da candidatura, faça anotações e reanalise após atualizar o perfil.
5. **Preenchimento assistido**: na página do formulário de candidatura → ícone → **Preencher formulário desta página** → revise e marque os campos → **Preencher**. Nada é enviado: confira e envie você mesmo. (Há também um formulário de demonstração para testes.)
6. **Configurações**: ajuste os pesos das dimensões, exporte/importe dados ou exclua tudo.

## Desenvolvimento

```bash
npm test            # testes unitários (Vitest)
npm run typecheck   # TypeScript estrito
npm run build       # typecheck + build de produção em dist/
npm run test:e2e    # teste de fumaça da extensão real (requer build; usa Edge/Chromium)
```

Documentação técnica:

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) — escopo e regras de produto
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — camadas, decisões e segurança
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — modelo de dados e armazenamento
- [docs/FIT_SCORING.md](docs/FIT_SCORING.md) — regras de classificação e pontuação
- [docs/TESTING.md](docs/TESTING.md) — estratégia e execução de testes

## Privacidade

Os dados ficam em `chrome.storage.local`, somente neste perfil do navegador. Permissões: `storage`, `activeTab` (acesso à aba atual **somente quando você clica** na extensão) e `scripting` (para ler a vaga/os campos nessa aba). Não há acesso permanente a sites, telemetria, servidores ou chamadas de rede. Os arquivos da pasta importada são lidos localmente e não são armazenados — só os dados que você escolhe importar. Desinstalar a extensão apaga os dados — exporte antes se quiser guardá-los.
