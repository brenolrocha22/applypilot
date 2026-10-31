import { describe, expect, it } from 'vitest';
import {
  certificateFromPath,
  classifyByPath,
  classifyText,
  dedupeDrafts,
  groupFolder,
  holderMatchesProfile,
  mergeCertificates,
  parseCertificateDocument,
  parseCertificateText,
  pathHints,
  redactSensitive,
} from '../../src/core/resume/certificate';
import { makeProfile, NOW } from '../fixtures/data';

// Textos fictícios que imitam os layouts reais mais comuns (nomes e números inventados).
const ESTACIO_LIKE = `Certificamos que
ANA EXEMPLO DA SILVA
concluiu o curso Minicurso Gratuito - Gestão do Tempo e
Produtividade
(3 horas) em 25 de JUNHO de 2024
00000000-aaaa-bbbb-cccc-000000000000
Sociedade de Ensino Superior Estácio de Sá Ltda - 00.000.000/0001-00`;

const PRIME_FRONT = `ANA EXEMPLO DA SILVA
Curso de Atendimento ao Cliente
35 horas
Junho de 2024
0000-00000000`;
const PRIME_BACK = `Embasamento Legal: Os Cursos oferecidos pela PRIME CURSOS DO BRASIL, têm base legal.
Conteúdo Programático:
Introdução`;

const ECERT_LIKE = `ANA EXEMPLO DA SILVA
Concluiu o curso de Lógica de Programação com carga horária total de 8 (oito) horas,
no qual adquiriu conhecimentos fundamentais.
Certificado emitido em 21 de setembro de 2026.
Powered by TCPDF (www.tcpdf.org)
Código do Certificado: ABC123 · Verifique autenticidade em: e-certificado.com`;

const DIPLOMA_LIKE = `de nacionalidade Brasileira, natural de Cidade Fictícia - XX, nascido em 11 de fevereiro de 1990, portador da carteira de
identidade nº 1234567 - XX-SDS, outorga-lhe o presente Diploma.
O Reitor da Universidade Fictícia do Norte, no uso de suas atribuições e tendo em vista a conclusão do
curso de Administração, em 15 de agosto de 2024 e a colação de grau em 25 de agosto de 2024, confere o
título de Bacharel a
ANA EXEMPLO DA SILVA`;

describe('parseCertificateText', () => {
  it('formato "Certificamos que … concluiu o curso" com nome em duas linhas', () => {
    const d = parseCertificateText(ESTACIO_LIKE, 'Cursos/x.pdf', 'Ana Exemplo da Silva');
    expect(d).toMatchObject({ kind: 'course', name: 'Gestão do Tempo e Produtividade', issuer: 'Estácio', hours: 3, date: '2024-06', basis: 'text' });
    expect(d.holderName).toBe('ANA EXEMPLO DA SILVA');
    expect(d.warnings.join(' ')).not.toMatch(/emitido para/);
  });

  it('formato "Curso de X / N horas / Mês de AAAA" com emissor no verso', () => {
    const [d] = parseCertificateDocument([PRIME_FRONT, PRIME_BACK], 'Livres/Atendimento.pdf', 'Ana Exemplo da Silva');
    expect(d).toMatchObject({ name: 'Atendimento ao Cliente', issuer: 'Prime Cursos', hours: 35, date: '2024-06' });
    expect(d!.holderName).toBe('ANA EXEMPLO DA SILVA');
  });

  it('formato "Concluiu o curso de X com carga horária…" e data de emissão', () => {
    const d = parseCertificateText(ECERT_LIKE, 'Tec/Logica (2026).pdf');
    expect(d).toMatchObject({ name: 'Lógica de Programação', hours: 8, date: '2026-09', credentialUrl: '' });
  });

  it('diploma vira formação acadêmica, usa a data de conclusão (não a de nascimento) e oculta documentos', () => {
    const d = parseCertificateText(DIPLOMA_LIKE, 'Formacao/Diploma.pdf', 'Ana Exemplo da Silva');
    expect(d).toMatchObject({ kind: 'degree', name: 'Administração', educationLevel: 'bachelor', issuer: 'Universidade Fictícia do Norte' });
    expect(d.date).toBe('2024-08');
    expect(d.snippet).not.toContain('1234567');
    expect(d.snippet).not.toMatch(/fevereiro de 1990/);
    expect(d.warnings.join(' ')).toMatch(/colação/);
  });

  it('alerta quando o documento está em nome de outra pessoa', () => {
    const d = parseCertificateText(ESTACIO_LIKE.replace('ANA EXEMPLO DA SILVA', 'JOÃO OUTRO NOME'), 'x.pdf', 'Ana Exemplo da Silva');
    expect(d.warnings.join(' ')).toMatch(/emitido para "JOÃO OUTRO NOME"/);
    expect(holderMatchesProfile('ANA E. DA SILVA', 'Ana Exemplo da Silva')).toBe(true);
  });

  it('formato em inglês com URL de credencial', () => {
    const d = parseCertificateText('This is to certify that Ana Silva has successfully completed Data Analysis Basics on March 3, 2025. Verify at coursera.org/verify/ABC123', 'en.pdf');
    expect(d).toMatchObject({ name: 'Data Analysis Basics', issuer: 'Coursera', date: '2025-03', credentialUrl: 'https://coursera.org/verify/ABC123' });
  });
});

describe('PDF com vários certificados', () => {
  it('cada página com âncora vira um certificado; versos e páginas em imagem são tratados', () => {
    const drafts = parseCertificateDocument([ESTACIO_LIKE, '', PRIME_FRONT, PRIME_BACK, ECERT_LIKE], 'reunidos.pdf');
    expect(drafts.map((d) => d.name)).toEqual(['Gestão do Tempo e Produtividade', 'Atendimento ao Cliente', 'Lógica de Programação']);
    expect(drafts[0]!.warnings.join(' ')).toMatch(/1 página\(s\).*imagem/);
  });
});

describe('nome do arquivo e da pasta como fonte', () => {
  it('lê emissor, ano e horas entre parênteses no fim do nome', () => {
    expect(pathHints('04 - Livres/Técnicas de Negociação (Escola Fictícia, 2024).pdf')).toMatchObject({ baseName: 'Técnicas de Negociação', issuer: 'Escola Fictícia', date: '2024' });
    expect(pathHints('Tec/Profissão Dev (110h, 2023).pdf')).toMatchObject({ baseName: 'Profissão Dev', hours: 110, date: '2023' });
  });

  it('não usa parênteses do meio do nome nem de pastas como emissor', () => {
    expect(pathHints('Cursos (Gestão, Vendas)/Introdução à POO (POO) com Python.webp').issuer).toBe('');
    expect(pathHints('02 - Bootcamps DIO/Bootcamp X (abr-mai-2026)/00 - Listas em Python.webp')).toMatchObject({ baseName: 'Listas em Python', issuer: 'DIO', date: '2026-05' });
  });

  it('certificado em imagem entra como rascunho "pelo nome do arquivo" com aviso', () => {
    const d = certificateFromPath('Bootcamps DIO/Turma (out-2026)/Introdução ao Excel.webp', 'Certificado em imagem.');
    expect(d).toMatchObject({ basis: 'file_name', name: 'Introdução ao Excel', issuer: 'DIO', date: '2026-10' });
    expect(d.warnings[0]).toMatch(/inferidos do nome do arquivo/);
  });

  it('classifica pelo caminho: currículo, outros documentos e certificados', () => {
    expect(classifyByPath('Carreira/CURRICULO ANA.pdf')).toBe('resume');
    expect(classifyByPath('Carreira/matricula.png')).toBe('other');
    expect(classifyByPath('x/email do git.png')).toBe('other');
    expect(classifyByPath('Materiais de Estudo/Guia.pdf')).toBe('other');
    expect(classifyByPath('Cursos/Excel Básico.pdf')).toBe('certificate');
  });

  it('classifica pelo texto', () => {
    expect(classifyText(ESTACIO_LIKE)).toBe('certificate');
    expect(classifyText(PRIME_FRONT)).toBe('certificate');
    expect(classifyText('E X P E R I Ê N C I A  P R O F I S S I O N A L\nx\nF O R M A Ç Ã O  A C A D Ê M I C A\ny')).toBe('resume');
    expect(classifyText('Prezados, venho por meio desta apresentar minha candidatura.')).toBe('other');
  });
});

describe('agrupamento, deduplicação e incorporação ao perfil', () => {
  const a = certificateFromPath('Bootcamps DIO/Bootcamp Dados (out-2026)/Excel 365.webp', 'img.');
  const b = certificateFromPath('Bootcamps DIO/Bootcamp Dados (out-2026)/Tabelas Dinâmicas.webp', 'img.');

  it('agrupa módulos da mesma pasta num único curso nomeado pela pasta', () => {
    const g = groupFolder([a, b]);
    expect(g).toMatchObject({ name: 'Bootcamp Dados', issuer: 'DIO', date: '2026-10', kind: 'course' });
    expect(g.snippet).toMatch(/2 certificados: Excel 365; Tabelas Dinâmicas/);
  });

  it('prefere a versão lida do texto quando há o mesmo certificado em PDF e imagem', () => {
    const fromText = parseCertificateText(ECERT_LIKE, 'Tec/x.pdf');
    const fromImage = certificateFromPath('Tec/Lógica de Programação.webp', 'img.');
    expect(dedupeDrafts([fromImage, fromText])).toEqual([fromText]);
  });

  it('adiciona como "extraído" (texto) ou "pendente" (nome do arquivo), sem duplicar', () => {
    const profile = makeProfile();
    const text = parseCertificateText(ECERT_LIKE, 'Tec/x.pdf');
    const r = mergeCertificates(profile, [text, a, { ...a, id: 'dup' }], 'certificate_file', NOW);
    expect(r.addedCourses).toBe(2);
    expect(r.skippedDuplicates).toBe(1);
    const added = r.profile.courses.find((c) => c.name === 'Lógica de Programação')!;
    expect(added).toMatchObject({ hours: 8, completionDate: '2026-09', provenance: { source: 'certificate_file', status: 'extracted' } });
    expect(r.profile.courses.find((c) => c.name === 'Excel 365')!.provenance.status).toBe('pending');
    expect(profile.courses).toHaveLength(0); // original intacto
  });

  it('diploma de formação já cadastrada não altera a data informada pelo usuário', () => {
    const profile = makeProfile(); // Bacharelado em Ciência da Computação, concluído em 2020-12
    const degree = { ...parseCertificateText(DIPLOMA_LIKE, 'Diploma.pdf'), name: 'Ciência da Computação' };
    const r = mergeCertificates(profile, [degree], 'certificate_file', NOW);
    expect(r.addedEducation).toBe(0);
    expect(r.matchedExisting).toHaveLength(1);
    expect(r.profile.education[0]!.endDate).toBe('2020-12');
    const other = mergeCertificates(profile, [parseCertificateText(DIPLOMA_LIKE, 'Diploma.pdf')], 'certificate_file', NOW);
    expect(other.addedEducation).toBe(1);
    expect(other.profile.education[1]).toMatchObject({ level: 'bachelor', degree: 'Administração', endDate: '2024-08', provenance: { status: 'extracted' } });
  });

  it('oculta números de documentos e datas de nascimento', () => {
    expect(redactSensitive('CPF 123.456.789-00, nascido em 1 de maio de 1990, RG: 7654321')).toBe('CPF [oculto], nascido(a) em [oculto], RG [oculto]');
  });
});
