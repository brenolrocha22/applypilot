# Especificação de produto — 0.2

## Objetivo

Ajudar uma pessoa a manter um perfil profissional estruturado e verificável, decidir com informação se vale se candidatar a uma vaga e reduzir o trabalho repetitivo de preencher formulários — sem enviar dados a terceiros.

Público da versão 0.1: uso pessoal, local, sem conta. A arquitetura permite evoluir para SaaS (ver ARCHITECTURE.md), mas nada de backend foi implementado.

## Princípios

1. **Nada é inventado.** O sistema não cria experiências, competências, resultados, certificados ou períodos. Extrações são sugestões revisáveis.
2. **Rastreabilidade.** Toda informação do perfil registra origem e estado de validação; toda conclusão do relatório aponta o requisito, o trecho original da vaga, a evidência no perfil, a justificativa e a incerteza.
3. **Ausência ≠ incapacidade.** Falta de evidência gera "Não comprovado", nunca "Não atendido".
4. **A nota não esconde bloqueios.** Requisitos obrigatórios/eliminatórios não atendidos são exibidos separadamente.
5. **Não é probabilidade de contratação.** O relatório diz isso explicitamente.
6. **Humano no controle.** Nada é sobrescrito, preenchido ou enviado sem revisão.

## Escopo implementado

### Perfil
Dados pessoais, resumo, experiências (com datas, conquistas e competências usadas), formação, competências (técnica, ferramenta, metodologia, área, comportamental), idiomas (5 níveis), certificações, cursos e preferências de trabalho (modalidade, locais, mudança, viagens, autonomia, colaboração, horários, contratação, pretensão salarial).

Estados de validação: Confirmado pelo usuário, Extraído de documento, Sugerido pela IA (reservado), Pendente de confirmação.

### Importação de currículo
PDF com texto, DOCX, TXT ou texto colado. Validação de tamanho (10 MB) e assinatura binária. Resultado: rascunho com seleção por item; campos pessoais preenchem apenas campos vazios; conflitos são listados; duplicatas ignoradas. Se a extração falhar, o usuário é orientado ao cadastro manual ou à colagem do texto.

### Vagas
Entrada manual: cargo, empresa, link, descrição. Extração de: responsabilidades, requisitos obrigatórios e desejáveis, competências/ferramentas, anos de experiência (geral ou por competência), formação, certificações, idiomas e nível, modalidade, local, viagens, autonomia, colaboração, horários. Senioridade é inferida apenas do título.

### Fit
Cinco dimensões independentes (técnico, experiência, formação, idiomas, cultural) com pesos configuráveis; ver FIT_SCORING.md.

### Relatório
Cargo/empresa, nota geral, métricas separadas (obrigatórios comprovados, desejáveis, parciais, não comprovados, não atendidos, cobertura), bloqueios, pontuação por dimensão, obrigatórios, competências correspondentes, experiências relevantes, parciais, lacunas, itens a confirmar, avaliação cultural, recomendação explicada, próximas ações, todos os requisitos com trecho original e limitações.

### Vagas salvas
Persistência local da entrada, da interpretação e do relatório; status (analisada, candidatura enviada, entrevistas, proposta, não selecionado, desisti); anotações; reanálise com o perfil atual.

### Preenchimento assistido
Formulário de demonstração local. Mapeamento por `autocomplete`, rótulo, `name`/`id` e placeholder com nível de confiança; campos ambíguos sinalizados; valores existentes nunca substituídos sem marcação explícita; senhas, documentos, CAPTCHA, arquivos e checkboxes não são tocados; o formulário nunca é enviado; registro da operação sem valores.

## Fora do escopo desta versão

- Gerar versões direcionadas do currículo (visão do produto; próxima etapa).
- OCR de certificados/currículos em imagem.
- Formulários dentro de iframes de outros domínios.
- Integração específica com LinkedIn.
- Qualquer IA (local ou paga) — exige aprovação prévia.
- Sincronização entre dispositivos, contas, backend.

## Critérios de conclusão (estado)

| Critério | Estado |
|---|---|
| Extensão carrega no Chrome | ✔ (verificado no teste E2E via Edge; Chrome usa o mesmo motor) |
| Cadastrar e recuperar perfil | ✔ |
| Importar currículo ou cadastrar manualmente | ✔ |
| Analisar descrição de vaga | ✔ |
| Calcular compatibilidade | ✔ |
| Justificativas e evidências | ✔ |
| Obrigatórios não comprovados destacados | ✔ |
| Salvar vaga | ✔ |
| Preencher formulário de demonstração | ✔ |
| Testes relevantes passando | ✔ (ver TESTING.md) |
| Build de produção | ✔ |
| Documentação de instalação e uso | ✔ |
