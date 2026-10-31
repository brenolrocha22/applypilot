# Changelog

## [0.4.0] — 2026-10-31

### Adicionado (relatado no teste do formulário)
- **Anexo do currículo**: o arquivo do currículo fica guardado na extensão (Perfil → "Arquivo do currículo", ou automaticamente pelo "Adicionar tudo ao perfil") e é anexado, com sua aprovação, em campos de arquivo como "Currículo (arquivo)" / "CV". Respeita o `accept` do campo; limite de 3 MB.
- **Guardar no perfil o que você digitou**: depois de analisar um formulário, campos que você preencheu na página e que o perfil não tem (resumo, pretensão salarial, nome, contatos, cidade…) podem ser guardados no perfil com um clique. Nunca sobrescreve dados existentes.
- **Cofre protegido por senha** (Configurações): arquivo `.applypilot` com perfil, vagas, configurações e arquivo do currículo, criptografado com AES-256-GCM (chave derivada da senha por PBKDF2-SHA-256, 600 mil iterações). A senha não é guardada. Serve de cópia segura e para retomar os dados em outro navegador.
- **Competências do LinkedIn pela página**: no seu perfil do LinkedIn, o popup oferece "Abrir competências do LinkedIn" e, na página de competências, "Importar competências desta página". Leitura só após o clique, sem navegação automática; entram como "Extraído", sem duplicar.
- **Preenchimento automático do navegador no Perfil**: os dados pessoais usam os tokens `autocomplete` (nome, e-mail, telefone, cidade, estado, país), para o Chrome/Google oferecer os dados salvos.

### Alterado
- Campo único "Cidade / Estado" passa a usar a localização ("Recife, PE") em vez de ficar ambíguo.
- O valor de campos de senha da página nunca é lido (antes era lido e descartado).

## [0.3.0] — 2026-10-31

### Corrigido (relatado no primeiro teste real)
- Dados pessoais e resumo do currículo não chegavam ao perfil: havia dois botões "Adicionar selecionados ao perfil" e o da área de certificados importava só certificados. Agora há um **botão único "Adicionar tudo ao perfil"** (currículo + LinkedIn + certificados) e os demais botões têm nomes distintos.
- Aba de Perfil aberta antes de uma importação ficava desatualizada e, ao salvar, podia sobrescrever os dados importados. Agora a tela se atualiza sozinha; se houver edições não salvas, avisa e pede confirmação antes de sobrescrever.

### Adicionado
- **LinkedIn**: leitura da exportação oficial de dados ("Obter uma cópia dos seus dados", .zip com CSVs) — perfil, resumo, cargos, formação, competências, idiomas, certificações, cursos, e-mail e telefone. O .zip pode ser escolhido diretamente ou ficar na pasta importada. Mensagens, conexões e demais dados do .zip não são lidos; data de nascimento e endereço completo não são importados.
- Experiências de fontes diferentes (currículo × LinkedIn) com mesma empresa e mesmo início não são duplicadas.

### Testes
- 126 testes unitários/integração e 28 verificações E2E (inclui o cenário do relato: aba de perfil aberta + importação em outra aba).

## [0.2.0] — 2026-10-31

### Adicionado
- **Vaga da página aberta**: botão "Analisar vaga desta página" no popup (JSON-LD `JobPosting`, texto selecionado ou conteúdo principal).
- **Preenchimento em sites reais**: botão "Preencher formulário desta página" com revisão no popup; agente injetado só após o clique (`activeTab` + `scripting`).
- **Importação de pasta/vários arquivos**: currículos, certificados e diplomas; certificados em imagem pelo nome do arquivo/pasta (pendentes); PDF com vários certificados; agrupamento de módulos de bootcamp; edição de nome/tipo antes de importar; alerta de documento em nome de outra pessoa.
- Diploma vira formação acadêmica e não altera formação já cadastrada (data de colação ≠ conclusão).
- Preferências declaradas no currículo ("Disponível para remoto, híbrido, viagens e mudança").
- Ocultação de números de documentos e data de nascimento nos trechos de origem.

### Melhorado (calibrado com documentos reais)
- Títulos com letras espaçadas, "Cargo · Empresa Local datas" numa linha, tópicos quebrados, rodapés de página, títulos combinados ("Formação acadêmica e idiomas"), instituições acentuadas, rótulos de categoria em competências, nível ("SQL básico"), cursos "Outras:".

### Testes
- 113 testes unitários/integração (eram 79) e 26 verificações E2E (eram 19).

## [0.1.0] — 2026-10-31

Primeira versão (MVP local).

### Adicionado
- Extensão Chrome MV3 com popup, app em aba e formulário de demonstração; permissão única `storage`.
- Perfil profissional completo com proveniência e estado de validação por item; validação; confirmação item a item.
- Importação de currículo (PDF, DOCX, TXT, texto colado) para rascunho revisável, sem sobrescrever dados.
- Parser de vagas por regras, com referência exata ao trecho original de cada requisito.
- Motor de fit em 5 dimensões com pesos configuráveis, cobertura, bloqueios independentes da nota e recomendação explicada.
- Relatório de compatibilidade com evidências, justificativas e incertezas.
- Vagas salvas com status de candidatura, anotações e reanálise.
- Preenchimento assistido com plano revisável, bloqueio de campos sensíveis e registro sem valores.
- Exportação/importação JSON e exclusão total dos dados.
- 79 testes unitários/integração e teste de fumaça E2E sem dependências.

### Pendências conhecidas
- Gerar versões direcionadas do currículo.
- Análise e preenchimento em páginas reais (exige aprovação de `activeTab` + `scripting`).
- IA opcional (exige aprovação).
- Testes E2E no Google Chrome branded (bloqueia `--load-extension`; validado no Edge).
