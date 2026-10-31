import { describe, expect, it } from 'vitest';
import { csvRecords, isLinkedInExport, linkedInExportToDraft, parseCsv } from '../../src/core/linkedin/export';
import { mergeDraftIntoProfile, selectAll } from '../../src/core/profile/merge';
import { createEmptyProfile } from '../../src/core/profile/factory';
import { parseResumeText } from '../../src/core/resume/parser';
import { LINKEDIN_FILES, NOW } from '../fixtures/data';

describe('CSV', () => {
  it('trata aspas, vírgulas e quebras de linha dentro de campos e BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","linha 1\nlinha 2"\n"com ""aspas""",z\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'linha 1\nlinha 2'],
      ['com "aspas"', 'z'],
    ]);
  });
  it('encontra o cabeçalho mesmo com notas antes', () => {
    expect(csvRecords('Notes:\n"Texto explicativo"\n\nName,Number\nCurso X,1\n', 'Name')).toEqual([{ Name: 'Curso X', Number: '1' }]);
  });
});

describe('exportação do LinkedIn → rascunho', () => {
  const d = linkedInExportToDraft(LINKEDIN_FILES, NOW);

  it('reconhece o conjunto de arquivos', () => {
    expect(isLinkedInExport(['Basic/Profile.csv', 'Basic/Positions.csv'])).toBe(true);
    expect(isLinkedInExport(['Profile.csv'])).toBe(false);
  });

  it('dados pessoais e resumo, sem data de nascimento nem endereço completo', () => {
    expect(Object.fromEntries(Object.entries(d.personal).map(([k, v]) => [k, v!.value]))).toEqual({
      fullName: 'Ana Exemplo',
      headline: 'Analista de Dados',
      city: 'Recife',
      state: 'Pernambuco',
      country: 'Brasil',
      portfolioUrl: 'https://ana.example.com',
      githubUrl: 'https://github.com/ana-exemplo',
      email: 'ana@example.com',
      phone: '+55 81 90000-0000',
    });
    expect(d.summary?.value).toBe('Profissional de dados.\nFoco em Python, SQL e BI.');
    expect(JSON.stringify(d)).not.toMatch(/1990|Rua Fictícia/);
  });

  it('cargos com datas, emprego atual e conquistas', () => {
    expect(d.experiences.map((e) => [e.title, e.company, e.startDate, e.endDate, e.current])).toEqual([
      ['Analista de Dados', 'Empresa Fictícia A', '2023-03', null, true],
      ['Consultora de Vendas', 'Empresa Fictícia B', '2020-01', '2022-12', false],
    ]);
    expect(d.experiences[0]!.achievements).toEqual(['Automatizei relatórios com Python']);
    expect(d.experiences[0]!.provenance).toMatchObject({ source: 'linkedin_export', status: 'extracted' });
  });

  it('formação, competências sem duplicatas, idiomas, certificações e cursos', () => {
    expect(d.education[0]).toMatchObject({ institution: 'Universidade Fictícia', level: 'bachelor', field: 'Administração', endDate: '2019' });
    expect(d.skills.map((s) => s.name)).toEqual(['Python', 'SQL', 'Power BI', 'Negociação']);
    expect(d.languages.map((l) => [l.name, l.level, l.provenance.status])).toEqual([
      ['Inglês', 'fluent', 'extracted'],
      ['Espanhol', 'intermediate', 'extracted'],
      ['Francês', 'basic', 'pending'],
    ]);
    expect(d.certifications[0]).toMatchObject({ name: 'Certificação Fictícia de Dados', issuer: 'Instituto Fictício', issueDate: '2024-06', credentialUrl: 'https://cred.example.com/1' });
    expect(d.courses.map((c) => c.name)).toEqual(['Estatística Básica']);
  });
});

describe('importação em um clique (currículo + LinkedIn)', () => {
  const RESUME = `Ana Exemplo
ana@example.com | (81) 90000-0000 | Recife - PE
Resumo
Analista de dados com foco em BI.
Experiência
Analista de Dados Sênior | Empresa Fictícia A
Mar 2023 - Atual
- Painéis
Habilidades
Python, Excel`;

  it('currículo tem prioridade; LinkedIn completa sem duplicar a mesma experiência', () => {
    const resume = parseResumeText(RESUME, 'resume_pdf', NOW);
    const linkedin = linkedInExportToDraft(LINKEDIN_FILES, NOW);
    let profile = createEmptyProfile(NOW);
    profile = mergeDraftIntoProfile(profile, resume, selectAll(resume), NOW).profile;
    const r = mergeDraftIntoProfile(profile, linkedin, selectAll(linkedin), NOW);
    const p = r.profile;
    expect(p.personal.fullName).toBe('Ana Exemplo');
    expect(p.summary.text).toBe('Analista de dados com foco em BI.'); // do currículo
    expect(p.personal.githubUrl).toBe('https://github.com/ana-exemplo'); // completado pelo LinkedIn
    // Mesma empresa e mesmo início: não duplica, mesmo com cargo diferente ("Sênior").
    expect(p.experiences.map((e) => e.company)).toEqual(['Empresa Fictícia A', 'Empresa Fictícia B']);
    expect(p.skills.map((s) => s.name)).toEqual(expect.arrayContaining(['Python', 'Excel', 'SQL', 'Power BI']));
    expect(p.skills.filter((s) => s.name === 'Python')).toHaveLength(1);
    expect(r.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(['personal.state', 'summary'])); // "PE" do currículo é mantido
  });
});
