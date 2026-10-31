# Modelo de dados

Tipos em `src/core/model/`. Datas parciais usam `YYYY-MM` (ou `YYYY`). Timestamps em ISO 8601.

## Proveniência (`Provenance`)

Presente em cada item de lista e nos blocos `personal`, `summary` e `preferences`.

| Campo | Valores |
|---|---|
| `source` | `manual`, `resume_pdf`, `resume_docx`, `resume_text`, `json_import`, `ai` |
| `status` | `confirmed` (Confirmado pelo usuário), `extracted` (Extraído de documento), `ai_suggested` (Sugerido pela IA), `pending` (Pendente de confirmação) |
| `sourceSnippet` | Trecho do documento que originou o item (para revisão) |
| `updatedAt` | Última alteração de estado |

Regras: cadastro manual ⇒ `confirmed`. Importação ⇒ `extracted` (ou `pending` quando há dúvida, ex.: nível de idioma não identificado). Só uma ação explícita ("Confirmar") muda para `confirmed`. Peso como evidência: confirmed 1,0; extracted/pending 0,8; ai_suggested 0.

## Perfil (`Profile`)

```
Profile
├─ schemaVersion: 1, createdAt, updatedAt
├─ personal: fullName, headline, email, phone, city, state, country,
│            linkedinUrl, githubUrl, portfolioUrl, provenance
├─ summary: text, provenance
├─ experiences[]: id, title, company, location, startDate, endDate, current,
│                 description, achievements[], skills[], provenance
├─ education[]: id, institution, degree, field,
│               level (high_school|technical|associate|bachelor|postgraduate|master|doctorate|other),
│               status (completed|in_progress|incomplete), startDate, endDate, provenance
├─ skills[]: id, name, category (technical|tool|methodology|domain|behavioral),
│            level?, yearsOfExperience?, provenance
├─ languages[]: id, name, level (basic|intermediate|advanced|fluent|native), provenance
├─ certifications[]: id, name, issuer, issueDate, expirationDate, credentialUrl, provenance
├─ courses[]: id, name, institution, hours, completionDate, provenance
└─ preferences: workModes[], preferredLocations[], willingToRelocate (bool|null),
                travelAvailability, autonomy, collaboration, schedule (null = não declarado),
                employmentTypes[], desiredSalary, provenance
```

Validação semântica: `validateProfile` (erros bloqueiam o salvamento; avisos não). Coerção estrutural: `coerceProfile` (usada ao ler do storage e ao importar JSON).

## Vaga

- `JobInput`: title, company, sourceUrl, description (máx. 50.000 caracteres).
- `ParsedJob`: requirements[], responsibilities[], sections[], minYearsExperience, seniority, workModes[], locations[], unstructuredLines[], warnings[].
- `JobRequirement`: id (`req-N`), kind, dimension, importance (`required|preferred|unspecified`), eliminatory, label, **source** `{start, end, text}` (offsets exatos na descrição; `-1` quando vem do título) e parâmetros por tipo (skillId, minYears, scopeSkillIds, educationLevel, certificationName, language, languageLevel, workMode, travel, cultureValue).
- `SavedJob`: id, input, parsed, report, status (`analyzed|applied|interviewing|offer|rejected|withdrawn`), notes, createdAt, updatedAt.

## Relatório (`FitReport`)

engineVersion, generatedAt, referenceDate, weights, overallScore (0–100 | null), coverage (0–1), dimensions[] (score|null, evaluable, note, assessments[]), counts, blockers[], relevantExperiences[], needsConfirmation[], recommendation, limitations[].

`RequirementAssessment`: requirement, status, credit, confidence, evidence[] (profilePath, description, snippet, validationStatus), justification, uncertainty, needsConfirmation.

## Preenchimento

- `FieldDescriptor`: descrição do campo independente do DOM.
- `FillPlanItem`: profileField, candidates[], value, confidence, action (`fill|same_value|skip_has_value|ambiguous|no_match|no_profile_value|blocked`), reason, selectedByDefault, requiresReview.
- `FillLog`: id, timestamp, page, entries[] (campo, propriedade, ação, resultado) — **sem valores**.

## Armazenamento

`chrome.storage.local` (via `Repository`):

| Chave | Conteúdo | Limite |
|---|---|---|
| `applypilot.profile` | `Profile` | — |
| `applypilot.jobs` | `SavedJob[]` | 300 |
| `applypilot.settings` | `{ weights }` | — |
| `applypilot.fillLogs` | `FillLog[]` | 30 mais recentes |

Exportação: `{ format: 'applypilot-export', version: 1, exportedAt, profile, jobs, settings }`. A importação aceita esse pacote ou um perfil isolado e substitui o perfil atual após confirmação.

Migrações: `schemaVersion` existe no perfil; `coerceProfile` preenche campos ausentes com padrões, o que cobre adições compatíveis. Mudanças incompatíveis exigirão uma função de migração por versão.
