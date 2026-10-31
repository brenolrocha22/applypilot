// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { acceptsFile, buildFillPlan, matchField, planField } from '../../src/core/fill/mapper';
import { applyFormAnswers, learnableAnswers } from '../../src/core/fill/learn';
import type { FieldDescriptor } from '../../src/core/fill/types';
import { collectFields } from '../../src/infra/fill/domAdapter';
import { createEmptyProfile } from '../../src/core/profile/factory';
import { cleanSkillNames, isLinkedInSkillsPage, linkedInProfileSlug, linkedInSkillsToDraft, linkedInSkillsUrl } from '../../src/core/linkedin/skillsPage';
import { extractLinkedInSkillTexts } from '../../src/infra/page/linkedinSkills';
import { mergeDraftIntoProfile, selectAll } from '../../src/core/profile/merge';
import { makeProfile, NOW } from '../fixtures/data';

const field = (over: Partial<FieldDescriptor>): FieldDescriptor => ({
  key: 'f',
  tag: 'input',
  type: 'text',
  name: '',
  id: '',
  label: '',
  placeholder: '',
  autocomplete: '',
  ariaLabel: '',
  currentValue: '',
  options: [],
  required: false,
  disabled: false,
  ...over,
});
const RESUME = { name: 'Curriculo Ana.pdf', type: 'application/pdf', size: 1000 };

describe('anexo do currículo', () => {
  const profile = makeProfile();

  it('campo de arquivo de currículo recebe o arquivo guardado, pré-selecionado', () => {
    const item = planField(field({ type: 'file', label: 'Currículo (arquivo)' }), profile, undefined, undefined, { resumeFile: RESUME });
    expect(item).toMatchObject({ action: 'fill', profileField: 'resumeFile', value: 'Curriculo Ana.pdf', selectedByDefault: true });
  });

  it('sem arquivo guardado, explica onde guardar', () => {
    const item = planField(field({ type: 'file', label: 'Anexe seu CV' }), profile);
    expect(item.action).toBe('no_profile_value');
    expect(item.reason).toMatch(/Arquivo do currículo/);
  });

  it('respeita o accept do campo e não usa arquivo em campos de texto', () => {
    expect(planField(field({ type: 'file', label: 'Currículo', accept: 'image/*' }), profile, undefined, undefined, { resumeFile: RESUME }).action).toBe('ambiguous');
    expect(acceptsFile('.pdf,.docx', 'a.PDF', '')).toBe(true);
    expect(acceptsFile('application/pdf', 'a.pdf', 'application/pdf')).toBe(true);
    expect(acceptsFile('.docx', 'a.pdf', 'application/pdf')).toBe(false);
    expect(matchField(field({ tag: 'textarea', type: 'textarea', label: 'Cole seu currículo' })).map((c) => c.profileField)).not.toContain('resumeFile');
    expect(planField(field({ type: 'file', label: 'Carta de apresentação' }), profile, undefined, undefined, { resumeFile: RESUME }).action).toBe('no_match');
  });

  it('campo que já tem o arquivo fica como "já preenchido"', () => {
    const item = planField(field({ type: 'file', label: 'CV', currentValue: 'C:\\fakepath\\Curriculo Ana.pdf' }), profile, undefined, undefined, { resumeFile: RESUME });
    expect(item.action).toBe('same_value');
  });
});

describe('campo único de cidade e estado', () => {
  it('"Cidade / Estado onde mora" usa a localização em vez de ficar ambíguo', () => {
    const item = planField(field({ label: 'Cidade / Estado onde mora' }), makeProfile());
    expect(item.profileField).toBe('location');
    expect(item.action).toBe('fill');
  });
});

describe('guardar no perfil o que foi digitado', () => {
  it('oferece só campos reconhecidos, vazios no perfil e preenchidos na página', () => {
    const profile = createEmptyProfile(NOW);
    const plan = buildFillPlan(
      [
        field({ key: 'a', label: 'Resumo profissional', tag: 'textarea', type: 'textarea', currentValue: 'Analista de dados com foco em BI.' }),
        field({ key: 'b', label: 'Pretensão salarial', currentValue: '3200' }),
        field({ key: 'c', label: 'Primeiro nome', currentValue: 'Ana' }),
        field({ key: 'd', label: 'Sobrenome', currentValue: 'Exemplo' }),
        field({ key: 'e', label: 'Crie uma senha', type: 'password', currentValue: '' }),
        field({ key: 'f', label: 'CPF', currentValue: '000.000.000-00' }),
        field({ key: 'g', label: 'E-mail', currentValue: '' }),
      ],
      profile,
    );
    const answers = learnableAnswers(plan);
    expect(answers.map((a) => a.profileField)).toEqual(['summary', 'desiredSalary', 'firstName', 'lastName']);
    const { profile: next, saved } = applyFormAnswers(profile, answers, NOW);
    expect(next.summary.text).toBe('Analista de dados com foco em BI.');
    expect(next.summary.provenance.status).toBe('confirmed');
    expect(next.preferences.desiredSalary).toBe('3200');
    expect(next.personal.fullName).toBe('Ana Exemplo');
    expect(saved).toContain('summary');
  });

  it('nunca sobrescreve o que o perfil já tem', () => {
    const profile = makeProfile();
    const { profile: next, saved } = applyFormAnswers(profile, [{ fieldKey: 'x', fieldLabel: 'E-mail', profileField: 'email', value: 'outro@example.com' }], NOW);
    expect(next.personal.email).toBe(profile.personal.email);
    expect(saved).toEqual([]);
  });

  it('não lê o valor de campos de senha da página', () => {
    document.body.innerHTML = '<form><label>Senha <input type="password" value="segredo123"></label><label>CV <input type="file" accept=".pdf"></label></form>';
    const { descriptors } = collectFields(document);
    expect(descriptors[0]!.currentValue).toBe('');
    expect(descriptors[1]).toMatchObject({ type: 'file', accept: '.pdf' });
  });
});

describe('competências da página do LinkedIn', () => {
  it('reconhece a página e monta o endereço das competências', () => {
    expect(isLinkedInSkillsPage('https://www.linkedin.com/in/ana-exemplo/details/skills/')).toBe(true);
    expect(isLinkedInSkillsPage('https://www.linkedin.com/in/ana-exemplo/')).toBe(false);
    expect(linkedInSkillsUrl('https://br.linkedin.com/in/ana-exemplo/?x=1')).toBe('https://www.linkedin.com/in/ana-exemplo/details/skills/');
    expect(linkedInProfileSlug('linkedin.com/in/Ana-Exemplo')).toBeNull();
    expect(linkedInProfileSlug('https://www.linkedin.com/in/Ana-Exemplo')).toBe('ana-exemplo');
  });

  it('extrai nomes dos itens e descarta abas, endossos e experiências', () => {
    document.body.innerHTML = `<main>
      <ul><li><span aria-hidden="true">Todas</span></li><li><span aria-hidden="true">Ferramentas e tecnologias</span></li></ul>
      <ul>
        <li><div><span aria-hidden="true">Power BI</span><span class="visually-hidden">Power BI</span></div>
          <ul><li><span aria-hidden="true">2 experiências em Empresa Fictícia</span></li><li><span aria-hidden="true">3 endossos</span></li></ul></li>
        <li><span aria-hidden="true">Python</span></li>
        <li><span aria-hidden="true">Análise de dados</span></li>
        <li><span aria-hidden="true">Mostrar todas as 40 competências</span></li>
      </ul></main>`;
    const names = cleanSkillNames(extractLinkedInSkillTexts(document));
    expect(names).toEqual(expect.arrayContaining(['Power BI', 'Python', 'Análise de dados']));
    expect(names.join('|')).not.toMatch(/Todas|Ferramentas|experiências|endossos|Mostrar/);
  });

  it('entra no perfil como extraído, sem duplicar competências existentes', () => {
    const profile = makeProfile();
    const existing = profile.skills[0]!.name;
    const draft = linkedInSkillsToDraft([existing, 'Competência Fictícia XYZ'], NOW);
    expect(draft.skills.every((s) => s.provenance.source === 'linkedin_page' && s.provenance.status === 'extracted')).toBe(true);
    const m = mergeDraftIntoProfile(profile, draft, selectAll(draft), NOW);
    expect(m.added.skills).toBe(1);
    expect(m.skippedDuplicates).toBe(1);
  });
});
