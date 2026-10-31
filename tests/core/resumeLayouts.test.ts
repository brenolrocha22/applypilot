import { describe, expect, it } from 'vitest';
import { joinWrappedLines, parseResumeText, parseSingleDate } from '../../src/core/resume/parser';
import { mergeDraftIntoProfile } from '../../src/core/profile/merge';
import { createEmptyProfile } from '../../src/core/profile/factory';
import { NOW } from '../fixtures/data';

// Layout real comum: títulos com letras espaçadas, "Cargo · Empresa Local datas" numa linha,
// tópicos quebrados em várias linhas e rodapé de página. Dados fictícios.
const RESUME = `Bruna Fictícia Lima · página 1 de 2
Bruna Fictícia Lima
Analista de Dados Júnior | Python · Excel · Power BI
Recife/PE · (81) 90000-0000 · bruna@example.com · linkedin.com/in/bruna-ficticia
Inglês fluente · Disponível para remoto, híbrido, viagens e mudança · CNH B
R E S U M O  P R O F I S S I O N A L
Profissional em transição para dados, com experiência em vendas orientadas a metas.
C O M P E T Ê N C I A S  T É C N I C A S
Dados e BI Excel avançado (PROCV, SOMASES), tabelas dinâmicas, Power BI, SQL básico
Web e ferramentas HTML, CSS, Git, Docker
E X P E R I Ê N C I A  P R O F I S S I O N A L
Inside Sales Representative · Empresa Fictícia Inc Remoto · Flórida, EUA 06/2024 – 12/2024
▪ Prospectei e qualifiquei leads por telefone e e-mail, 100% em inglês, para serviços residenciais e
comerciais, registrando tudo no CRM.
▪ Calculei orçamentos.
Bruna Fictícia Lima · página 2 de 2
Promotora de Trade Marketing · Mídia Fictícia Non Traditional Recife/PE 07/2021 – 12/2022
▪ Gerenciei carteira de lojas.
Consultora de Vendas · Loja Fictícia São Paulo/SP 01/2021 – 06/2021
▪ Atendi clientes.
Anteriores: Recepcionista, Hotel Fictício (2014–2015) · Assistente, Empresa X (2014)
F O R M A Ç Ã O  C O M P L E M E N T A R
▪ Bootcamp Fictício — Dados e IA na Prática · Plataforma Y, 29 h, concluído em out. 2026 — Excel e análise de dados, fórmulas,
tabelas dinâmicas e dashboards
▪ Curso Programador (110 h) — front-end, back-end e cloud · Professor Z, 2023
Outras: Jornada Dev (6 h, 2022) · Comunicação Empresarial (Escola Fictícia, 2024)
F O R M A Ç Ã O  A C A D Ê M I C A  E  I D I O M A S
Bacharelado em Administração · Centro Universitário Fictício (UniF), Cidade Fictícia/PE · concluído em
08/2019
Inglês: fluente · Espanhol: básico`;

describe('currículo com layout real (letras espaçadas, linhas compactas)', () => {
  const d = parseResumeText(RESUME, 'resume_pdf', NOW);

  it('reconhece títulos com letras espaçadas e ignora rodapés de página', () => {
    expect(d.warnings.join(' ')).not.toMatch(/Nenhuma seção/);
    expect(d.summary?.value).toMatch(/transição para dados/);
    expect(JSON.stringify(d)).not.toMatch(/página 2 de 2/);
  });

  it('separa cargo, empresa e local na mesma linha das datas', () => {
    expect(d.experiences.map((e) => [e.title, e.company, e.location, e.startDate, e.endDate])).toEqual([
      ['Inside Sales Representative', 'Empresa Fictícia Inc', 'Remoto · Flórida, EUA', '2024-06', '2024-12'],
      ['Promotora de Trade Marketing', 'Mídia Fictícia Non Traditional', 'Recife/PE', '2021-07', '2022-12'],
      ['Consultora de Vendas', 'Loja Fictícia', 'São Paulo/SP', '2021-01', '2021-06'],
    ]);
  });

  it('junta tópicos quebrados em várias linhas', () => {
    expect(d.experiences[0]!.achievements).toEqual([
      'Prospectei e qualifiquei leads por telefone e e-mail, 100% em inglês, para serviços residenciais e comerciais, registrando tudo no CRM.',
      'Calculei orçamentos.',
    ]);
  });

  it('não transforma a linha "Anteriores:" numa experiência e avisa', () => {
    expect(d.experiences).toHaveLength(3);
    expect(d.warnings.join(' ')).toMatch(/Anteriores: Recepcionista/);
  });

  it('competências: remove rótulos de categoria e detalhes, e registra o nível', () => {
    const names = d.skills.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Excel', 'tabelas dinâmicas', 'Power BI', 'SQL', 'HTML', 'CSS', 'Git', 'Docker']));
    expect(names.some((n) => /Dados e BI|Web e ferramentas|PROCV/.test(n))).toBe(false);
    expect(d.skills.find((s) => s.name === 'SQL')?.level).toBe('basic');
  });

  it('cursos: nome, instituição, horas e data, inclusive em linhas "Outras:"', () => {
    expect(d.courses.map((c) => [c.name, c.institution, c.hours, c.completionDate])).toEqual([
      ['Bootcamp Fictício — Dados e IA na Prática', 'Plataforma Y', 29, '2026-10'],
      ['Curso Programador', 'Professor Z', 110, '2023'],
      ['Jornada Dev', '', 6, '2022'],
      ['Comunicação Empresarial', 'Escola Fictícia', null, '2024'],
    ]);
  });

  it('formação no título combinado "Formação acadêmica e idiomas", com instituição acentuada e data quebrada', () => {
    expect(d.education).toHaveLength(1);
    expect(d.education[0]).toMatchObject({ level: 'bachelor', degree: 'Bacharelado em Administração', institution: 'Centro Universitário Fictício (UniF)', endDate: '2019-08', status: 'completed' });
    expect(d.languages.map((l) => `${l.name}:${l.level}`)).toEqual(['Inglês:fluent', 'Espanhol:basic']);
  });

  it('extrai preferências declaradas e só as aplica se não estiverem preenchidas', () => {
    expect(d.preferences).toMatchObject({ workModes: ['remote', 'hybrid'], travelAvailability: 'occasional', willingToRelocate: true });
    const r = mergeDraftIntoProfile(createEmptyProfile(NOW), d, { personal: [], summary: false, preferences: true, items: {} }, NOW);
    expect(r.profile.preferences).toMatchObject({ workModes: ['remote', 'hybrid'], willingToRelocate: true, provenance: { status: 'extracted' } });
    const existing = createEmptyProfile(NOW);
    existing.preferences.workModes = ['onsite'];
    const r2 = mergeDraftIntoProfile(existing, d, { personal: [], summary: false, preferences: true, items: {} }, NOW);
    expect(r2.profile.preferences.workModes).toEqual(['onsite']);
    expect(r2.profile.preferences.provenance.status).toBe('pending');
  });
});

describe('utilitários de layout', () => {
  it('joinWrappedLines junta continuação, mas não novas linhas com datas ou itens curtos', () => {
    expect(joinWrappedLines(['- Automatizei relatórios com Python e Pandas', 'Assistente - Empresa'])).toHaveLength(2);
    expect(joinWrappedLines(['- texto longo que foi quebrado pelo layout do arquivo PDF bem no meio da frase e', 'continua aqui'])).toHaveLength(1);
    expect(joinWrappedLines(['x'.repeat(80), 'Cargo · Empresa 01/2020 - 02/2021'])).toHaveLength(2);
  });

  it('parseSingleDate entende mês abreviado, MM/AAAA e ano', () => {
    expect(parseSingleDate('concluído em out. 2026')).toBe('2026-10');
    expect(parseSingleDate('concluído em 08/2019')).toBe('2019-08');
    expect(parseSingleDate('Professor Z, 2023')).toBe('2023');
  });
});
