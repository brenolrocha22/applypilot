// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildFillPlan, chooseOption, matchField, planField } from '../../src/core/fill/mapper';
import type { FieldDescriptor } from '../../src/core/fill/types';
import { applyFillPlan, collectFields } from '../../src/infra/fill/domAdapter';
import { extracted, makeProfile, REFERENCE_DATE } from '../fixtures/data';

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

describe('matchField', () => {
  it('prioriza autocomplete, depois rótulo, name/id e placeholder', () => {
    expect(matchField(field({ autocomplete: 'email' }))[0]).toMatchObject({ profileField: 'email', confidence: 0.95 });
    expect(matchField(field({ label: 'Nome completo' }))[0]).toMatchObject({ profileField: 'fullName', confidence: 0.85 });
    expect(matchField(field({ name: 'first_name' }))[0]).toMatchObject({ profileField: 'firstName', confidence: 0.75 });
    expect(matchField(field({ placeholder: 'Seu telefone' }))[0]).toMatchObject({ profileField: 'phone', confidence: 0.65 });
  });

  it('não confunde nome da empresa ou sobrenome com nome completo', () => {
    expect(matchField(field({ label: 'Nome da empresa' })).map((c) => c.profileField)).not.toContain('fullName');
    expect(matchField(field({ label: 'Sobrenome' }))[0]?.profileField).toBe('lastName');
  });
});

describe('planField', () => {
  const profile = makeProfile();

  it('preenche campo reconhecido e vazio, pré-selecionado', () => {
    const item = planField(field({ label: 'E-mail' }), profile);
    expect(item).toMatchObject({ action: 'fill', value: 'ana.exemplo@example.com', selectedByDefault: true });
  });

  it('não substitui silenciosamente valor existente', () => {
    const item = planField(field({ label: 'E-mail', currentValue: 'outro@example.com' }), profile);
    expect(item.action).toBe('skip_has_value');
    expect(item.selectedByDefault).toBe(false);
    expect(planField(field({ label: 'E-mail', currentValue: 'ANA.exemplo@example.com' }), profile).action).toBe('same_value');
  });

  it('bloqueia senha, CPF, CAPTCHA e arquivos', () => {
    expect(planField(field({ type: 'password', label: 'Senha' }), profile).action).toBe('blocked');
    expect(planField(field({ label: 'CPF' }), profile).action).toBe('blocked');
    expect(planField(field({ name: 'g-recaptcha-response' }), profile).action).toBe('blocked');
    expect(planField(field({ type: 'file', label: 'Currículo' }), profile).action).toBe('blocked');
  });

  it('sinaliza campo ambíguo e campo não reconhecido', () => {
    const ambiguous = planField(field({ label: 'Cidade / Estado' }), profile);
    expect(ambiguous.action).toBe('ambiguous');
    expect(ambiguous.candidates.map((c) => c.profileField)).toEqual(expect.arrayContaining(['city', 'state']));
    expect(planField(field({ label: 'Carta de apresentação' }), profile).action).toBe('no_match');
  });

  it('permite que o usuário resolva a ambiguidade escolhendo o campo do perfil', () => {
    const item = planField(field({ label: 'Cidade / Estado' }), profile, 'city');
    expect(item).toMatchObject({ action: 'fill', value: 'São Paulo' });
  });

  it('dado sensível (pretensão salarial) exige revisão e não é pré-selecionado', () => {
    const p = makeProfile();
    p.preferences.desiredSalary = 'R$ 10.000';
    const item = planField(field({ label: 'Pretensão salarial' }), p);
    expect(item).toMatchObject({ action: 'fill', selectedByDefault: false, requiresReview: true });
  });

  it('dado não confirmado exige revisão', () => {
    const p = makeProfile();
    p.personal.provenance = extracted;
    expect(planField(field({ label: 'E-mail' }), p).requiresReview).toBe(true);
  });

  it('informa quando o perfil não tem o dado', () => {
    const p = makeProfile();
    p.personal.portfolioUrl = '';
    expect(planField(field({ label: 'Portfólio' }), p).action).toBe('no_profile_value');
  });

  it('mapeia valores para opções de select', () => {
    const options = [
      { value: '', label: 'Selecione' },
      { value: 'b', label: 'Básico' },
      { value: 'i', label: 'Intermediário' },
      { value: 'a', label: 'Avançado' },
    ];
    expect(chooseOption(options, 'englishLevel', 'Intermediário')).toBe('i');
    const item = planField(field({ tag: 'select', type: 'select', label: 'Nível de inglês', options }), profile);
    expect(item).toMatchObject({ action: 'fill', value: 'i' });
    const edu = planField(
      field({ tag: 'select', type: 'select', label: 'Escolaridade', options: [{ value: 'em', label: 'Ensino médio' }, { value: 'sup', label: 'Graduação' }] }),
      profile,
    );
    expect(edu.value).toBe('sup');
  });

  it('calcula anos de experiência de forma determinística', () => {
    expect(planField(field({ label: 'Anos de experiência' }), profile, undefined, REFERENCE_DATE).value).toBe('6');
  });
});

describe('adaptador DOM (formulário real)', () => {
  it('coleta campos, aplica somente os aprovados e registra o resultado sem valores', () => {
    document.body.innerHTML = `
      <form id="f">
        <label for="n">Nome completo *</label><input id="n" name="nome">
        <label>E-mail <input type="email" name="email" value="ja@existente.com"></label>
        <input name="phone" placeholder="Telefone">
        <input type="password" name="senha" aria-label="Senha">
        <input type="hidden" name="token" value="x">
        <button type="submit">Enviar</button>
      </form>`;
    let submitted = false;
    document.getElementById('f')!.addEventListener('submit', () => (submitted = true));

    const { descriptors, elements } = collectFields(document.body);
    expect(descriptors.map((d) => d.name)).toEqual(['nome', 'email', 'phone', 'senha']);
    expect(descriptors[0]!.label).toBe('Nome completo');

    const plan = buildFillPlan(descriptors, makeProfile());
    expect(plan.map((p) => p.action)).toEqual(['fill', 'skip_has_value', 'fill', 'blocked']);

    const approved = new Set(plan.filter((p) => p.selectedByDefault).map((p) => p.field.key));
    const log = applyFillPlan(plan, approved, elements, 'demo', 'log-1');

    expect((document.querySelector('[name=nome]') as HTMLInputElement).value).toBe('Ana Exemplo da Silva');
    expect((document.querySelector('[name=email]') as HTMLInputElement).value).toBe('ja@existente.com');
    expect((document.querySelector('[name=senha]') as HTMLInputElement).value).toBe('');
    expect(log).toMatchObject({ filled: 2, skipped: 2, failed: 0 });
    expect(JSON.stringify(log)).not.toContain('Ana Exemplo');
    expect(submitted).toBe(false);
  });

  it('rótulo de select não inclui o texto das opções', () => {
    document.body.innerHTML = `<label>Estado (UF) <select name="uf"><option value="">Selecione</option><option>SP</option><option>RJ</option></select></label>`;
    const { descriptors } = collectFields(document.body);
    expect(descriptors[0]!.label).toBe('Estado (UF)');
    expect(buildFillPlan(descriptors, makeProfile())[0]).toMatchObject({ action: 'fill', value: 'SP' });
  });

  it('dispara eventos input/change para compatibilidade com frameworks', () => {
    document.body.innerHTML = `<label for="e">E-mail</label><input id="e" name="email">`;
    const events: string[] = [];
    const input = document.getElementById('e')!;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    const { descriptors, elements } = collectFields(document.body);
    const plan = buildFillPlan(descriptors, makeProfile());
    applyFillPlan(plan, new Set([plan[0]!.field.key]), elements, 'demo', 'l');
    expect(events).toEqual(['input', 'change']);
  });
});
