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
