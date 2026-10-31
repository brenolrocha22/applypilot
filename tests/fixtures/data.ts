import type { Profile } from '../../src/core/model/profile';
import type { JobInput } from '../../src/core/model/job';
import type { Provenance } from '../../src/core/model/provenance';
import { createEmptyProfile } from '../../src/core/profile/factory';

/** Dados 100% fictícios para testes. */

export const NOW = '2026-01-15T12:00:00.000Z';
export const REFERENCE_DATE = new Date('2026-01-15T00:00:00.000Z');

export const confirmed: Provenance = { source: 'manual', status: 'confirmed', updatedAt: NOW };
export const extracted: Provenance = { source: 'resume_pdf', status: 'extracted', updatedAt: NOW, sourceSnippet: 'trecho' };

export function makeProfile(): Profile {
  const p = createEmptyProfile(NOW);
  p.personal = {
    ...p.personal,
    fullName: 'Ana Exemplo da Silva',
    headline: 'Desenvolvedora Front-end',
    email: 'ana.exemplo@example.com',
    phone: '+55 11 90000-0000',
    city: 'São Paulo',
    state: 'SP',
    country: 'Brasil',
    linkedinUrl: 'https://www.linkedin.com/in/ana-exemplo',
    githubUrl: 'https://github.com/ana-exemplo',
  };
  p.summary = { text: 'Desenvolvedora com foco em aplicações web acessíveis usando React e TypeScript.', provenance: confirmed };
  p.experiences = [
    {
      id: 'exp-1',
      title: 'Desenvolvedora Front-end',
      company: 'Empresa Fictícia A',
      location: 'São Paulo',
      startDate: '2021-03',
      endDate: null,
      current: true,
      description: 'Desenvolvimento de interfaces web com React e TypeScript. Criação de testes automatizados com Jest. Integração com APIs REST.',
      achievements: ['Reduzi o tempo de carregamento das páginas principais.'],
      skills: ['React', 'TypeScript', 'Jest'],
      provenance: confirmed,
    },
    {
      id: 'exp-2',
      title: 'Estagiária de Desenvolvimento',
      company: 'Empresa Fictícia B',
      location: 'Campinas',
      startDate: '2019-06',
      endDate: '2021-02',
      current: false,
      description: 'Manutenção de sistemas em PHP e MySQL. Suporte a usuários internos.',
      achievements: [],
      skills: ['PHP', 'MySQL'],
      provenance: confirmed,
    },
  ];
  p.education = [
    {
      id: 'edu-1',
      institution: 'Universidade Fictícia',
      degree: 'Bacharelado em Ciência da Computação',
      field: 'Ciência da Computação',
      level: 'bachelor',
      status: 'completed',
      startDate: '2016-02',
      endDate: '2020-12',
      provenance: confirmed,
    },
  ];
  p.skills = [
    { id: 'sk-1', name: 'React', category: 'technical', level: 'advanced', provenance: confirmed },
    { id: 'sk-2', name: 'TypeScript', category: 'technical', level: 'advanced', provenance: confirmed },
    { id: 'sk-3', name: 'Git', category: 'tool', provenance: confirmed },
    { id: 'sk-4', name: 'Docker', category: 'tool', provenance: extracted },
  ];
  p.languages = [
    { id: 'lang-1', name: 'Português', level: 'native', provenance: confirmed },
    { id: 'lang-2', name: 'Inglês', level: 'intermediate', provenance: confirmed },
  ];
  p.preferences = {
    ...p.preferences,
    workModes: ['remote', 'hybrid'],
    preferredLocations: ['São Paulo'],
    willingToRelocate: false,
    travelAvailability: 'occasional',
    autonomy: 'high',
    collaboration: 'collaborative',
    schedule: 'flexible',
  };
  return p;
}

export const JOB_TEXT = `Somos uma empresa fictícia de tecnologia.

Responsabilidades:
- Desenvolver interfaces web com React e TypeScript
- Escrever testes automatizados
- Colaborar com o time de produto

Requisitos obrigatórios:
- 3+ anos de experiência com desenvolvimento front-end
- Experiência com React, TypeScript e Next.js
- Inglês avançado (obrigatório)
- Ensino superior completo em Computação ou áreas afins
- Conhecimento em SQL

Diferenciais:
- Experiência com Kubernetes
- Certificação AWS Certified Developer
- Vivência com Vue.js

Modelo de trabalho: híbrido em São Paulo, com autonomia para organizar a rotina.
Benefícios:
- Auxílio home office
- Horário flexível
`;

export const JOB: JobInput = {
  title: 'Desenvolvedora Front-end Pleno',
  company: 'Empresa Fictícia C',
  sourceUrl: 'https://example.com/vaga/123',
  description: JOB_TEXT,
};

// CSVs fictícios no formato da exportação "Obter uma cópia dos seus dados" do LinkedIn.
export const LINKEDIN_FILES: Record<string, string> = {
  'Profile.csv':
    '﻿First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n' +
    'Ana,Exemplo,,"Rua Fictícia, 100","Jan 1, 1990",Analista de Dados,"Profissional de dados.\nFoco em Python, SQL e BI.",Tecnologia,00000-000,"Recife, Pernambuco, Brasil",,"[PORTFOLIO:https://ana.example.com,OTHER:https://github.com/ana-exemplo]",\n',
  'Positions.csv':
    'Company Name,Title,Description,Location,Started On,Finished On\n' +
    'Empresa Fictícia A,Analista de Dados,"Painéis em Power BI.\n- Automatizei relatórios com Python",Recife,Mar 2023,\n' +
    'Empresa Fictícia B,Consultora de Vendas,Vendas B2B.,"São Paulo, SP",Jan 2020,Dec 2022\n',
  'Education.csv':
    'School Name,Start Date,End Date,Notes,Degree Name,Activities\nUniversidade Fictícia,2015,2019,,"Bacharelado, Administração",\n',
  'Skills.csv': 'Name\nPython\nSQL\nPower BI\nNegociação\nPython\n',
  'Languages.csv': 'Name,Proficiency\nInglês,Full professional proficiency\nEspanhol,Proficiência profissional limitada\nFrancês,\n',
  'Certifications.csv': 'Name,Url,Authority,Started On,Finished On,License Number\nCertificação Fictícia de Dados,https://cred.example.com/1,Instituto Fictício,Jun 2024,,ABC\n',
  'Courses.csv': 'Name,Number\nEstatística Básica,\n',
  'Email Addresses.csv': 'Email Address,Confirmed,Primary,Updated On\nantigo@example.com,Yes,No,1/1/20\nana@example.com,Yes,Yes,1/1/24\n',
  'PhoneNumbers.csv': 'Extension,Number,Type\n,+55 81 90000-0000,Mobile\n',
};
