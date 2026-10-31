import { describe, expect, it } from 'vitest';
import { coerceProfile, hasErrors, validateProfile } from '../../src/core/profile/validation';
import { mergedMonths, totalYears } from '../../src/core/profile/dates';
import { createEmptyProfile } from '../../src/core/profile/factory';
import { mergeDraftIntoProfile } from '../../src/core/profile/merge';
import { parseResumeText } from '../../src/core/resume/parser';
import { makeProfile, NOW, REFERENCE_DATE } from '../fixtures/data';

describe('validateProfile', () => {
  it('aceita o perfil fictício válido', () => {
    expect(hasErrors(validateProfile(makeProfile()))).toBe(false);
  });

  it('aponta e-mail, URL, datas e campos obrigatórios inválidos', () => {
    const p = makeProfile();
    p.personal.email = 'invalido';
    p.personal.linkedinUrl = 'linkedin.com/in/x';
    p.experiences[1]!.endDate = '2018-01'; // anterior ao início
    p.skills.push({ ...p.skills[0]!, id: 'dup' }); // duplicada
    p.languages.push({ id: 'x', name: '', level: 'basic', provenance: p.skills[0]!.provenance });
    const issues = validateProfile(p);
    const paths = issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['personal.email', 'personal.linkedinUrl', 'experiences[1]', 'languages[2].name']));
    expect(issues.find((i) => i.message.includes('duplicada'))?.severity).toBe('warning');
    expect(hasErrors(issues)).toBe(true);
  });

  it('perfil vazio gera apenas aviso de nome', () => {
    const issues = validateProfile(createEmptyProfile(NOW));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
  });
});

describe('coerceProfile (dados externos não confiáveis)', () => {
  it('rejeita valores que não são objetos', () => {
    expect(() => coerceProfile('x')).toThrow();
    expect(() => coerceProfile(null)).toThrow();
  });

  it('descarta campos desconhecidos, corrige tipos e marca origem desconhecida como pendente', () => {
    const p = coerceProfile(
      {
        personal: { fullName: 'Teste', email: 42, evil: '<script>' },
        skills: [{ name: 'Python', category: 'hacker', provenance: { status: 'superuser' } }, 'lixo'],
        languages: [{ name: 'Inglês', level: 'ultra' }],
        preferences: { workModes: ['remote', 'spaceship'] },
      },
      NOW,
    );
    expect(p.personal.fullName).toBe('Teste');
    expect(p.personal.email).toBe('');
    expect('evil' in p.personal).toBe(false);
    expect(p.skills).toHaveLength(1);
    expect(p.skills[0]!.category).toBe('technical');
    expect(p.skills[0]!.provenance.status).toBe('pending');
    expect(p.languages[0]!.level).toBe('basic');
    expect(p.preferences.workModes).toEqual(['remote']);
  });

  it('é idempotente para um perfil válido', () => {
    const p = makeProfile();
    expect(coerceProfile(JSON.parse(JSON.stringify(p)), NOW)).toEqual(p);
  });
});

describe('cálculo de anos de experiência', () => {
  it('não conta períodos sobrepostos duas vezes', () => {
    expect(mergedMonths([
      { experienceId: 'a', start: 0, end: 12 },
      { experienceId: 'b', start: 6, end: 18 },
      { experienceId: 'c', start: 24, end: 30 },
    ])).toBe(24);
  });

  it('considera emprego atual até a data de referência e ignora experiências sem data', () => {
    const p = makeProfile();
    p.experiences.push({ ...p.experiences[0]!, id: 'sem-data', startDate: null, current: false });
    const r = totalYears(p.experiences, REFERENCE_DATE);
    expect(r.years).toBe(6.7); // 21 meses + 59 meses = 80 meses
    expect(r.undatedExperienceIds).toEqual(['sem-data']);
  });
});

const RESUME = `Carlos Fictício Souza
Analista de Dados
carlos.ficticio@example.com | (11) 98888-7777 | Belo Horizonte - MG
linkedin.com/in/carlos-ficticio

Resumo
Analista com experiência em Python, SQL e Power BI.

Experiência Profissional
Analista de Dados | Empresa Fictícia Ltda
Jan 2022 - Atual
- Construí painéis em Power BI
- Automatizei relatórios com Python e Pandas
Assistente Administrativo - Outra Empresa Fictícia
03/2019 - 12/2021
Controle de planilhas em Excel.

Formação Acadêmica
Bacharelado em Estatística - Universidade Fictícia Federal
2015 - 2019

Habilidades
Python, SQL, Power BI, Excel, Comunicação

Idiomas
Inglês avançado
Espanhol

Certificações
Microsoft Certified: Power BI Data Analyst - Microsoft (2023)

Cursos
Estatística aplicada - Escola Fictícia (40h) 2021
`;

describe('parseResumeText', () => {
  const d = parseResumeText(RESUME, 'resume_text', NOW);

  it('extrai dados pessoais com o trecho de origem', () => {
    expect(d.personal.fullName?.value).toBe('Carlos Fictício Souza');
    expect(d.personal.headline?.value).toBe('Analista de Dados');
    expect(d.personal.email?.value).toBe('carlos.ficticio@example.com');
    expect(d.personal.phone?.value).toBe('(11) 98888-7777');
    expect(d.personal.linkedinUrl?.value).toBe('https://linkedin.com/in/carlos-ficticio');
    expect(d.personal.city?.value).toBe('Belo Horizonte');
    expect(d.personal.state?.value).toBe('MG');
  });

  it('extrai experiências com datas, cargo, empresa e conquistas', () => {
    expect(d.experiences).toHaveLength(2);
    const [a, b] = d.experiences;
    expect(a).toMatchObject({ title: 'Analista de Dados', company: 'Empresa Fictícia Ltda', startDate: '2022-01', current: true, endDate: null });
    expect(a!.achievements).toHaveLength(2);
    expect(a!.skills).toEqual(expect.arrayContaining(['Python', 'Pandas', 'Power BI']));
    expect(b).toMatchObject({ title: 'Assistente Administrativo', company: 'Outra Empresa Fictícia', startDate: '2019-03', endDate: '2021-12' });
    expect(b!.description).toMatch(/Excel/);
  });

  it('marca tudo como extraído (nunca confirmado) e guarda o trecho', () => {
    for (const item of [...d.experiences, ...d.skills, ...d.education, ...d.certifications, ...d.courses]) {
      expect(item.provenance.status === 'extracted' || item.provenance.status === 'pending').toBe(true);
      expect(item.provenance.sourceSnippet).toBeTruthy();
    }
  });

  it('extrai formação, competências, idiomas, certificações e cursos', () => {
    expect(d.education[0]).toMatchObject({ level: 'bachelor', institution: 'Universidade Fictícia Federal', startDate: '2015', endDate: '2019' });
    expect(d.skills.map((s) => s.name)).toEqual(expect.arrayContaining(['Python', 'SQL', 'Power BI', 'Excel', 'Comunicação', 'Pandas']));
    expect(d.languages.find((l) => l.name === 'Inglês')?.level).toBe('advanced');
    const es = d.languages.find((l) => l.name === 'Espanhol');
    expect(es?.provenance.status).toBe('pending'); // nível não identificado
    expect(d.warnings.join(' ')).toMatch(/Espanhol/);
    expect(d.certifications[0]).toMatchObject({ name: 'Microsoft Certified: Power BI Data Analyst', issuer: 'Microsoft', issueDate: '2023' });
    expect(d.courses[0]).toMatchObject({ name: 'Estatística aplicada', institution: 'Escola Fictícia', hours: 40 });
  });

  it('avisa quando não reconhece seções', () => {
    expect(parseResumeText('texto qualquer sem estrutura nenhuma aqui', 'resume_text', NOW).warnings.length).toBeGreaterThan(0);
  });
});

describe('mergeDraftIntoProfile', () => {
  const draft = parseResumeText(RESUME, 'resume_pdf', NOW);
  const allItems = {
    experiences: draft.experiences.map((e) => e.id),
    skills: draft.skills.map((s) => s.id),
    languages: draft.languages.map((l) => l.id),
  };

  it('preenche apenas campos vazios e registra conflitos sem sobrescrever', () => {
    const profile = makeProfile(); // já tem nome e e-mail confirmados
    profile.personal.headline = '';
    const r = mergeDraftIntoProfile(profile, draft, { personal: ['fullName', 'email', 'headline'], summary: true, items: {} }, NOW);
    expect(r.profile.personal.fullName).toBe('Ana Exemplo da Silva');
    expect(r.profile.personal.headline).toBe('Analista de Dados');
    expect(r.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(['personal.fullName', 'personal.email', 'summary']));
    expect(r.profile.personal.provenance.status).toBe('pending');
  });

  it('adiciona apenas os itens selecionados, ignora duplicatas e não altera o original', () => {
    const profile = makeProfile();
    const before = JSON.stringify(profile);
    const r = mergeDraftIntoProfile(profile, draft, { personal: [], summary: false, items: allItems }, NOW);
    expect(JSON.stringify(profile)).toBe(before);
    expect(r.added.experiences).toBe(2);
    expect(r.skippedDuplicates).toBeGreaterThanOrEqual(1); // Inglês já existe
    const imported = r.profile.skills.find((s) => s.name === 'Power BI');
    expect(imported?.provenance.status).toBe('extracted');
    expect(r.profile.skills.find((s) => s.name === 'React')?.provenance.status).toBe('confirmed');
  });

  it('perfil vazio recebe dados pessoais como "extraídos"', () => {
    const r = mergeDraftIntoProfile(createEmptyProfile(NOW), draft, { personal: ['fullName', 'email'], summary: true, items: {} }, NOW);
    expect(r.profile.personal.fullName).toBe('Carlos Fictício Souza');
    expect(r.profile.personal.provenance).toMatchObject({ source: 'resume_pdf', status: 'extracted' });
    expect(r.profile.summary.provenance.status).toBe('extracted');
  });
});
