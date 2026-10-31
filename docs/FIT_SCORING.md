# Motor de fit — regras de classificação e pontuação

Código: `src/core/fit/` (função pura `computeFit(profile, parsedJob, options)`). Versão do motor: `0.1.0`.

> A pontuação mede a correspondência entre o perfil e os requisitos **identificados** na vaga. Não é probabilidade de contratação.

## 1. Extração de requisitos (`src/core/job/parser.ts`)

1. A descrição é dividida em linhas, preservando offsets (cada requisito guarda o trecho original exato).
2. Títulos de seção (PT/EN) definem o contexto: obrigatórios, desejáveis, responsabilidades, benefícios, cultura, sobre, local. "Requisitos: Java, SQL" na mesma linha também é reconhecido.
3. Importância por linha: seção de requisitos ⇒ `required`; diferenciais ⇒ `preferred`; sem seção ⇒ `unspecified`. Marcadores na linha prevalecem ("desejável", "diferencial", "nice to have" ⇒ desejável; "obrigatório", "imprescindível", "required" ⇒ obrigatório).
4. **Eliminatório** apenas com termos explícitos: obrigatório, imprescindível, indispensável, eliminatório, mandatory, must have.
5. Detecção: competências (dicionário + competências do próprio perfil fora do dicionário; alias mais longo primeiro), anos ("3+ anos de experiência", "3 a 5 anos"; exige palavra de experiência), formação, certificações, idiomas e nível, modalidade, local, viagens, autonomia, colaboração, horários.
6. Responsabilidades viram itens de experiência; tecnologias citadas nelas viram requisitos `unspecified`.
7. Linhas de requisitos sem nada estruturado viram requisitos `other` (avaliados só por semelhança textual).
8. Senioridade (Júnior 1, Pleno 3, Sênior 5, Liderança 7 anos) vem **somente do título** e só é usada se não houver anos explícitos.
9. Duplicatas: mantém-se a maior importância/nível; "eliminatório" é preservado.
10. "Auxílio home office" em benefícios não indica trabalho remoto; "maior de 18 anos" não é experiência.

## 2. Estados dos requisitos

| Estado | Crédito | Quando |
|---|---|---|
| Atendido | 1,0 | Evidência direta, ou competência que **implica** a exigida (ex.: PostgreSQL ⇒ SQL, Next.js ⇒ React), com justificativa |
| Parcialmente atendido | 0,5 (ou proporcional para anos) | Competência **semelhante** (ex.: Vue ~ React), nível de idioma 1 abaixo, formação em andamento, anos ≥ 75% do mínimo, curso em vez de certificação, semelhança textual parcial |
| Não comprovado | 0 | Sem evidência no perfil. **Ausência não significa que você não possui.** |
| Não atendido | 0 | Somente com evidência contrária no próprio perfil: nível de idioma declarado ≥ 2 abaixo; formação confirmada inferior; anos insuficientes com todas as experiências confirmadas e datadas; conflito com preferência declarada |
| Não aplicável | — (excluído) | Aspecto cultural sem preferência declarada; modalidade alternativa já atendida; local de vaga remota |

Competências semelhantes nunca são tratadas como equivalentes. Linhas não estruturadas nunca chegam a "Atendido".

## 3. Confiança da evidência

Crédito efetivo = crédito × confiança, onde confiança = maior peso entre as evidências usadas: confirmado 1,0; extraído/pendente 0,8; sugerido pela IA 0 (não conta). Evidências não confirmadas aparecem em "Informações que precisam de confirmação".

## 4. Dimensões

| Dimensão | Peso padrão | Requisitos |
|---|---|---|
| Técnico | 35% | Competências técnicas, ferramentas, metodologias, domínios |
| Experiência | 30% | Anos (geral e por competência), senioridade, responsabilidades, competências comportamentais, linhas não estruturadas |
| Formação | 15% | Nível de formação, certificações (cursos contam parcialmente) |
| Idiomas | 10% | Idioma e nível |
| Cultural | 10% | Modalidade, local, viagens, autonomia, colaboração, horários |

**Pesos são provisórios** e configuráveis em *Configurações* (normalizados para somar 100%). Pesos inválidos fazem o motor usar o padrão.

### Pontuação de uma dimensão

```
peso_req = peso_importância × fator_tipo
  peso_importância: obrigatório 2 · não especificado 1,5 · desejável 1
  fator_tipo: responsabilidade 0,5 · linha não estruturada 0,75 · demais 1
score = 100 × Σ(peso_req × crédito × confiança) / Σ(peso_req)     (exclui "não aplicável")
```

### Dimensão não avaliável (não vale zero)

- A vaga não tem requisitos dessa dimensão; ou
- O perfil não tem dados da dimensão (sem experiências; sem formação/cursos/certificações; sem idiomas; sem competências nem experiências); ou
- Fit cultural: a vaga não descreve o ambiente ⇒ **"Dados insuficientes para avaliar o fit cultural."**; ou a vaga descreve, mas você não declarou preferências correspondentes.

Nesses casos a dimensão fica `n/a`, seus requisitos continuam listados (e bloqueios continuam destacados).

## 5. Nota geral e cobertura

```
nota  = Σ(peso_dim × score_dim) / Σ(peso_dim)      somente dimensões avaliáveis
cobertura = Σ(peso_dim das avaliáveis)              (0–100%)
```

Sem nenhuma dimensão avaliável ⇒ nota `null` e recomendação "dados insuficientes".

## 6. Indicadores separados

- % de obrigatórios **comprovadamente** atendidos (só "Atendido" conta).
- Desejáveis atendidos (x/y).
- Parcialmente atendidos, não comprovados, não atendidos.
- Cobertura.

## 7. Bloqueios

Todo requisito eliminatório **ou** obrigatório cujo estado não seja "Atendido"/"Não aplicável" aparece no quadro vermelho, independentemente da nota (eliminatórios e "não atendidos" primeiro).

## 8. Recomendação

| Nível | Condição |
|---|---|
| Revisar bloqueios | Existe ao menos um bloqueio |
| Boa correspondência | Nota ≥ 75 |
| Correspondência parcial | 50 ≤ nota < 75 |
| Baixa correspondência | Nota < 50 |
| Dados insuficientes | Nota indisponível |

Inclui explicação (nota e cobertura, pontos fortes ≥ 75, pontos de atenção < 50, obrigatórios, conflitos culturais) e próximas ações (adicionar evidências de obrigatórios não comprovados, confirmar dados extraídos, completar o perfil quando a cobertura < 60%).

## 9. Determinismo

Mesmo perfil + mesma vaga + mesmos pesos + mesma `referenceDate` ⇒ relatório idêntico (testado). A data de referência afeta apenas empregos atuais.

## 10. Limitações conhecidas

- Extração por regras: requisitos escritos de forma incomum, tabelas ou listas em parágrafo podem não ser identificados; o relatório mostra avisos e linhas não estruturadas.
- O dicionário de competências é limitado (~100 itens) e voltado a tecnologia; termos fora dele só são reconhecidos se existirem no seu perfil.
- A área da formação ("em Computação ou afins") não é verificada — aparece como incerteza.
- Semelhança de responsabilidades usa sobreposição de palavras, não semântica.
- Experiências sobrepostas são mescladas no cálculo de anos; experiências sem data não contam.
- Detecção de local é simples ("presencial em X", "Local: X").
- Negações ("não é remoto") não são interpretadas.
