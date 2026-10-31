import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AutonomyPreference,
  CollaborationPreference,
  EducationLevel,
  EducationStatus,
  EmploymentType,
  LanguageLevel,
  Profile,
  ProfileListKey,
  SchedulePreference,
  SkillCategory,
  SkillLevel,
  TravelAvailability,
  WorkMode,
} from '../../../core/model/profile';
import { manualProvenance, type Provenance } from '../../../core/model/provenance';
import {
  createEmptyProfile,
  emptyCertification,
  emptyCourse,
  emptyEducation,
  emptyExperience,
  emptyLanguage,
  emptySkill,
  nowIso,
} from '../../../core/profile/factory';
import { ResumeFileCard } from '../../components/ResumeFileCard';
import { hasErrors, validateProfile, type ValidationIssue } from '../../../core/profile/validation';
import { EDUCATION_LEVEL_LABELS } from '../../../core/knowledge/education';
import { LANGUAGE_LEVEL_LABELS } from '../../../core/knowledge/languages';
import { CheckboxGroup, MonthField, Section, SelectField, TextArea, TextField } from '../../components/fields';
import { ProvenanceBadge, repo } from '../../shared';

const SKILL_CATEGORIES: Record<SkillCategory, string> = { technical: 'Técnica', tool: 'Ferramenta', methodology: 'Metodologia', domain: 'Área de conhecimento', behavioral: 'Comportamental' };
const SKILL_LEVELS: Record<SkillLevel, string> = { basic: 'Básico', intermediate: 'Intermediário', advanced: 'Avançado', expert: 'Especialista' };
const EDU_STATUS: Record<EducationStatus, string> = { completed: 'Concluído', in_progress: 'Em andamento', incomplete: 'Incompleto' };
const WORK_MODES: Record<WorkMode, string> = { remote: 'Remoto', hybrid: 'Híbrido', onsite: 'Presencial' };
const TRAVEL: Record<TravelAvailability, string> = { none: 'Sem disponibilidade', occasional: 'Ocasional', frequent: 'Frequente' };
const AUTONOMY: Record<AutonomyPreference, string> = { high: 'Alta autonomia', moderate: 'Autonomia moderada', structured: 'Ambiente estruturado' };
const COLLAB: Record<CollaborationPreference, string> = { collaborative: 'Colaborativo', balanced: 'Equilibrado', independent: 'Mais independente' };
const SCHEDULE: Record<SchedulePreference, string> = { flexible: 'Horário flexível', fixed: 'Horário fixo', shifts_ok: 'Aceito escalas/turnos' };
const EMPLOYMENT: Record<EmploymentType, string> = { clt: 'CLT', pj: 'PJ', internship: 'Estágio', temporary: 'Temporário', freelance: 'Freelance' };
const YES_NO = { yes: 'Sim', no: 'Não' } as const;

const confirmProv = (p: Provenance): Provenance => ({ ...p, status: 'confirmed', updatedAt: nowIso() });
const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  /** Versão (updatedAt) do perfil gravado que esta tela carregou — detecta alterações feitas em outra aba. */
  const version = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [staleNotice, setStaleNotice] = useState(false);

  const reload = useCallback(() => {
    repo
      .loadProfile()
      .then((p) => {
        version.current = p?.updatedAt ?? null;
        setProfile(p ?? createEmptyProfile());
        setDirty(false);
        setStaleNotice(false);
      })
      .catch(() => {
        setMessage({ kind: 'bad', text: 'Não foi possível ler o perfil salvo. Um perfil vazio foi carregado; seus dados originais não foram alterados.' });
        setProfile(createEmptyProfile());
      });
  }, []);

  useEffect(() => {
    reload();
    // Importações e outras abas atualizam o perfil: sem edições pendentes, recarrega; com edições, avisa.
    return repo.onProfileChange(async () => {
      const stored = await repo.loadProfile().catch(() => null);
      if (!stored || stored.updatedAt === version.current) return; // gravação feita por esta própria tela
      if (dirtyRef.current) setStaleNotice(true);
      else reload();
    });
  }, [reload]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const pendingCount = useMemo(() => {
    if (!profile) return 0;
    const lists: ProfileListKey[] = ['experiences', 'education', 'skills', 'languages', 'certifications', 'courses'];
    return (
      lists.reduce((n, k) => n + (profile[k] as { provenance: Provenance }[]).filter((i) => i.provenance.status !== 'confirmed').length, 0) +
      [profile.personal, profile.summary, profile.preferences].filter((b) => b.provenance.status !== 'confirmed').length
    );
  }, [profile]);

  if (!profile) return <p>Carregando…</p>;

  const update = (fn: (draft: Profile) => void) => {
    const next = structuredClone(profile);
    fn(next);
    setProfile(next);
    setDirty(true);
    setMessage(null);
  };

  const save = async () => {
    const found = validateProfile(profile);
    setIssues(found);
    if (hasErrors(found)) {
      setMessage({ kind: 'bad', text: 'Corrija os erros indicados antes de salvar.' });
      return;
    }
    try {
      const stored = await repo.loadProfile().catch(() => null);
      if (stored && version.current !== null && stored.updatedAt !== version.current) {
        const overwrite = confirm(
          [
            'O perfil foi alterado em outra aba ou por uma importação depois que esta tela foi aberta.',
            '',
            'OK = sobrescrever com o que está nesta tela',
            'Cancelar = manter os dados atuais e recarregar',
          ].join('\n'),
        );
        if (!overwrite) {
          reload();
          return;
        }
      }
      const clean = structuredClone(profile);
      for (const e of clean.experiences) e.achievements = e.achievements.map((a) => a.trim()).filter(Boolean);
      version.current = await repo.saveProfile(clean);
      setDirty(false);
      setMessage({ kind: 'ok', text: 'Perfil salvo localmente.' });
    } catch (e) {
      setMessage({ kind: 'bad', text: `Falha ao salvar: ${(e as Error).message}` });
    }
  };

  const confirmAll = () =>
    update((d) => {
      d.personal.provenance = confirmProv(d.personal.provenance);
      d.summary.provenance = confirmProv(d.summary.provenance);
      d.preferences.provenance = confirmProv(d.preferences.provenance);
      for (const k of ['experiences', 'education', 'skills', 'languages', 'certifications', 'courses'] as const) {
        for (const item of d[k] as { provenance: Provenance }[]) item.provenance = confirmProv(item.provenance);
      }
    });

  const prov = () => manualProvenance(nowIso());
  const per = profile.personal;
  const setPersonal = (key: Exclude<keyof Profile['personal'], 'provenance'>) => (v: string) => update((d) => void (d.personal[key] = v));
  const pref = profile.preferences;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h1>Perfil profissional</h1>
          <p className="muted">Somente informações que você confirmar são tratadas como comprovadas. Nada é inventado ou alterado sem sua revisão.</p>
        </div>
        <div className="row">
          {pendingCount > 0 && (
            <button onClick={confirmAll} title="Marca todos os itens como confirmados por você">
              Confirmar todos ({pendingCount})
            </button>
          )}
          <button className="primary" onClick={save} disabled={!dirty}>
            {dirty ? 'Salvar perfil' : 'Salvo'}
          </button>
        </div>
      </div>

      {staleNotice && (
        <div className="alert warn">
          O perfil foi atualizado em outra aba (por exemplo, por uma importação). Suas edições nesta tela ainda não foram salvas.{' '}
          <button onClick={reload}>Carregar dados atualizados (descarta edições desta tela)</button>
        </div>
      )}
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      {issues.length > 0 && (
        <div className={`alert ${hasErrors(issues) ? 'bad' : 'warn'}`}>
          <strong>Validação:</strong>
          <ul>
            {issues.map((i, n) => (
              <li key={n}>
                {i.severity === 'error' ? 'Erro' : 'Aviso'} em <code>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pendingCount > 0 && (
        <div className="alert warn">
          {pendingCount} informação(ões) aguardam sua confirmação (borda amarela). Revise o conteúdo e clique em “Confirmar” em cada item.
        </div>
      )}

      <ResumeFileCard />

      <Section
        title="Dados pessoais"
        actions={
          <>
            <ProvenanceBadge provenance={per.provenance} />
            {per.provenance.status !== 'confirmed' && <button onClick={() => update((d) => void (d.personal.provenance = confirmProv(d.personal.provenance)))}>Confirmar</button>}
          </>
        }
      >
        {/* Formulário com tokens de preenchimento: o Chrome/Google oferece seus dados salvos (aceite a sugestão com Tab ou Enter). */}
        <form autoComplete="on" onSubmit={(e) => e.preventDefault()}>
        <div className="grid2">
          <TextField label="Nome completo" autoComplete="name" value={per.fullName} onChange={setPersonal('fullName')} />
          <TextField label="Título profissional" autoComplete="organization-title" value={per.headline} onChange={setPersonal('headline')} placeholder="Ex.: Desenvolvedora Front-end" />
          <TextField label="E-mail" type="email" autoComplete="email" value={per.email} onChange={setPersonal('email')} />
          <TextField label="Telefone" type="tel" autoComplete="tel" value={per.phone} onChange={setPersonal('phone')} />
        </div>
        <div className="grid3">
          <TextField label="Cidade" autoComplete="address-level2" value={per.city} onChange={setPersonal('city')} />
          <TextField label="Estado/UF" autoComplete="address-level1" value={per.state} onChange={setPersonal('state')} />
          <TextField label="País" autoComplete="country-name" value={per.country} onChange={setPersonal('country')} />
          <TextField label="LinkedIn (URL)" type="url" value={per.linkedinUrl} onChange={setPersonal('linkedinUrl')} />
          <TextField label="GitHub (URL)" type="url" value={per.githubUrl} onChange={setPersonal('githubUrl')} />
          <TextField label="Portfólio (URL)" type="url" value={per.portfolioUrl} onChange={setPersonal('portfolioUrl')} />
        </div>
        </form>
      </Section>

      <Section
        title="Resumo profissional"
        actions={
          <>
            <ProvenanceBadge provenance={profile.summary.provenance} />
            {profile.summary.provenance.status !== 'confirmed' && <button onClick={() => update((d) => void (d.summary.provenance = confirmProv(d.summary.provenance)))}>Confirmar</button>}
          </>
        }
      >
        <TextArea label="Resumo" rows={4} value={profile.summary.text} onChange={(v) => update((d) => void (d.summary.text = v))} />
      </Section>

      <ListSection
        title="Experiências profissionais"
        description="Datas são usadas para calcular seus anos de experiência. Indique as competências usadas em cada experiência."
        items={profile.experiences}
        onChange={(items) => update((d) => void (d.experiences = items))}
        create={() => emptyExperience(prov())}
        summary={(e) => `${e.title || 'Sem cargo'}${e.company ? ` — ${e.company}` : ''}`}
        render={(e, set) => (
          <>
            <div className="grid3">
              <TextField label="Cargo" value={e.title} onChange={(v) => set({ title: v })} />
              <TextField label="Empresa" value={e.company} onChange={(v) => set({ company: v })} />
              <TextField label="Local" value={e.location} onChange={(v) => set({ location: v })} />
              <MonthField label="Início" value={e.startDate} onChange={(v) => set({ startDate: v })} />
              <MonthField label="Término" value={e.endDate} disabled={e.current} onChange={(v) => set({ endDate: v })} />
              <label className="inline" style={{ marginTop: 24 }}>
                <input type="checkbox" checked={e.current} onChange={(ev) => set({ current: ev.target.checked, endDate: ev.target.checked ? null : e.endDate })} />
                Emprego atual
              </label>
            </div>
            <TextArea label="Descrição das atividades" value={e.description} onChange={(v) => set({ description: v })} />
            <TextArea label="Resultados e conquistas (um por linha)" value={e.achievements.join('\n')} onChange={(v) => set({ achievements: v.split('\n') })} />
            <TextField label="Competências usadas (separadas por vírgula)" value={e.skills.join(', ')} onChange={(v) => set({ skills: splitList(v) })} />
          </>
        )}
      />

      <ListSection
        title="Formação acadêmica"
        items={profile.education}
        onChange={(items) => update((d) => void (d.education = items))}
        create={() => emptyEducation(prov())}
        summary={(e) => `${EDUCATION_LEVEL_LABELS[e.level]}${e.degree ? `: ${e.degree}` : ''}${e.institution ? ` — ${e.institution}` : ''}`}
        render={(e, set) => (
          <div className="grid3">
            <TextField label="Instituição" value={e.institution} onChange={(v) => set({ institution: v })} />
            <TextField label="Curso" value={e.degree} onChange={(v) => set({ degree: v })} />
            <TextField label="Área" value={e.field} onChange={(v) => set({ field: v })} />
            <SelectField<EducationLevel> label="Nível" value={e.level} options={EDUCATION_LEVEL_LABELS} onChange={(v) => set({ level: v ?? 'other' })} />
            <SelectField<EducationStatus> label="Situação" value={e.status} options={EDU_STATUS} onChange={(v) => set({ status: v ?? 'completed' })} />
            <div className="grid2">
              <MonthField label="Início" value={e.startDate} onChange={(v) => set({ startDate: v })} />
              <MonthField label="Conclusão" value={e.endDate} onChange={(v) => set({ endDate: v })} />
            </div>
          </div>
        )}
      />

      <ListSection
        title="Competências"
        description="Competências técnicas, ferramentas, metodologias e competências comportamentais declaradas."
        items={profile.skills}
        onChange={(items) => update((d) => void (d.skills = items))}
        create={() => emptySkill(prov())}
        summary={(s) => s.name || 'Nova competência'}
        compact
        render={(s, set) => (
          <div className="grid3" style={{ gridTemplateColumns: '2fr 1.2fr 1.2fr 0.8fr' }}>
            <TextField label="Nome" value={s.name} onChange={(v) => set({ name: v })} />
            <SelectField<SkillCategory> label="Categoria" value={s.category} options={SKILL_CATEGORIES} onChange={(v) => set({ category: v ?? 'technical' })} />
            <SelectField<SkillLevel> label="Nível" value={s.level} options={SKILL_LEVELS} allowEmpty="Não informado" onChange={(v) => set({ level: v ?? undefined })} />
            <TextField
              label="Anos"
              type="number"
              value={s.yearsOfExperience === undefined ? '' : String(s.yearsOfExperience)}
              onChange={(v) => set({ yearsOfExperience: v === '' ? undefined : Number(v) })}
            />
          </div>
        )}
      />

      <ListSection
        title="Idiomas"
        items={profile.languages}
        onChange={(items) => update((d) => void (d.languages = items))}
        create={() => emptyLanguage(prov())}
        summary={(l) => `${l.name || 'Novo idioma'} — ${LANGUAGE_LEVEL_LABELS[l.level]}`}
        compact
        render={(l, set) => (
          <div className="grid2">
            <TextField label="Idioma" value={l.name} onChange={(v) => set({ name: v })} placeholder="Ex.: Inglês" />
            <SelectField<LanguageLevel> label="Nível" value={l.level} options={LANGUAGE_LEVEL_LABELS} onChange={(v) => set({ level: v ?? 'basic' })} />
          </div>
        )}
      />

      <ListSection
        title="Certificações"
        items={profile.certifications}
        onChange={(items) => update((d) => void (d.certifications = items))}
        create={() => emptyCertification(prov())}
        summary={(c) => c.name || 'Nova certificação'}
        render={(c, set) => (
          <div className="grid3">
            <TextField label="Nome" value={c.name} onChange={(v) => set({ name: v })} />
            <TextField label="Emissor" value={c.issuer} onChange={(v) => set({ issuer: v })} />
            <TextField label="URL da credencial" type="url" value={c.credentialUrl} onChange={(v) => set({ credentialUrl: v })} />
            <MonthField label="Emissão" value={c.issueDate} onChange={(v) => set({ issueDate: v })} />
            <MonthField label="Validade" value={c.expirationDate} onChange={(v) => set({ expirationDate: v })} />
          </div>
        )}
      />

      <ListSection
        title="Cursos"
        items={profile.courses}
        onChange={(items) => update((d) => void (d.courses = items))}
        create={() => emptyCourse(prov())}
        summary={(c) => c.name || 'Novo curso'}
        render={(c, set) => (
          <div className="grid3">
            <TextField label="Nome" value={c.name} onChange={(v) => set({ name: v })} />
            <TextField label="Instituição" value={c.institution} onChange={(v) => set({ institution: v })} />
            <div className="grid2">
              <TextField label="Horas" type="number" value={c.hours === null ? '' : String(c.hours)} onChange={(v) => set({ hours: v === '' ? null : Number(v) })} />
              <MonthField label="Conclusão" value={c.completionDate} onChange={(v) => set({ completionDate: v })} />
            </div>
          </div>
        )}
      />

      <Section
        title="Preferências de trabalho"
        description="Usadas apenas no fit cultural, comparadas com características descritas explicitamente pela vaga. Deixe em branco o que não quiser declarar."
        actions={
          <>
            <ProvenanceBadge provenance={pref.provenance} />
            {pref.provenance.status !== 'confirmed' && <button onClick={() => update((d) => void (d.preferences.provenance = confirmProv(d.preferences.provenance)))}>Confirmar</button>}
          </>
        }
      >
        <CheckboxGroup<WorkMode> legend="Modalidades que aceito" options={WORK_MODES} value={pref.workModes} onChange={(v) => update((d) => void (d.preferences.workModes = v))} />
        <CheckboxGroup<EmploymentType> legend="Tipos de contratação" options={EMPLOYMENT} value={pref.employmentTypes} onChange={(v) => update((d) => void (d.preferences.employmentTypes = v))} />
        <div className="grid3">
          <TextField
            label="Locais preferidos (separados por vírgula)"
            value={pref.preferredLocations.join(', ')}
            onChange={(v) => update((d) => void (d.preferences.preferredLocations = splitList(v)))}
          />
          <SelectField<'yes' | 'no'>
            label="Aceito mudança de cidade"
            value={pref.willingToRelocate === null ? null : pref.willingToRelocate ? 'yes' : 'no'}
            options={YES_NO}
            allowEmpty="Não informado"
            onChange={(v) => update((d) => void (d.preferences.willingToRelocate = v === null ? null : v === 'yes'))}
          />
          <SelectField<TravelAvailability> label="Disponibilidade para viagens" value={pref.travelAvailability} options={TRAVEL} allowEmpty="Não informado" onChange={(v) => update((d) => void (d.preferences.travelAvailability = v))} />
          <SelectField<AutonomyPreference> label="Autonomia" value={pref.autonomy} options={AUTONOMY} allowEmpty="Não informado" onChange={(v) => update((d) => void (d.preferences.autonomy = v))} />
          <SelectField<CollaborationPreference> label="Forma de trabalho" value={pref.collaboration} options={COLLAB} allowEmpty="Não informado" onChange={(v) => update((d) => void (d.preferences.collaboration = v))} />
          <SelectField<SchedulePreference> label="Horários" value={pref.schedule} options={SCHEDULE} allowEmpty="Não informado" onChange={(v) => update((d) => void (d.preferences.schedule = v))} />
          <TextField label="Pretensão salarial (opcional)" value={pref.desiredSalary} onChange={(v) => update((d) => void (d.preferences.desiredSalary = v))} />
        </div>
      </Section>

      <div className="row">
        <button className="primary" onClick={save} disabled={!dirty}>
          {dirty ? 'Salvar perfil' : 'Salvo'}
        </button>
      </div>
    </div>
  );
}

interface ListItem {
  id: string;
  provenance: Provenance;
}

function ListSection<T extends ListItem>(props: {
  title: string;
  description?: string;
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  summary: (item: T) => string;
  render: (item: T, set: (patch: Partial<T>) => void) => ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const setItem = (id: string, patch: Partial<T>) => props.onChange(props.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Section
      title={`${props.title} (${props.items.length})`}
      description={props.description}
      actions={
        <button
          onClick={() => {
            const item = props.create();
            props.onChange([...props.items, item]);
            setOpen((s) => new Set(s).add(item.id));
          }}
        >
          + Adicionar
        </button>
      }
    >
      {props.items.length === 0 && <p className="muted">Nenhum item cadastrado.</p>}
      {props.items.map((item) => {
        const expanded = open.has(item.id) || props.compact;
        return (
          <div key={item.id} className={`item ${item.provenance.status !== 'confirmed' ? 'unconfirmed' : ''}`}>
            <div className="row between">
              {props.compact ? (
                <span />
              ) : (
                <button className="link" style={{ border: 'none', padding: 0, fontWeight: 600, background: 'none' }} onClick={() => toggle(item.id)} aria-expanded={expanded}>
                  {expanded ? '▾' : '▸'} {props.summary(item)}
                </button>
              )}
              <div className="row">
                <ProvenanceBadge provenance={item.provenance} />
                {item.provenance.status !== 'confirmed' && <button onClick={() => setItem(item.id, { provenance: confirmProv(item.provenance) } as Partial<T>)}>Confirmar</button>}
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`Excluir "${props.summary(item)}"?`)) props.onChange(props.items.filter((i) => i.id !== item.id));
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
            {item.provenance.sourceSnippet && item.provenance.status !== 'confirmed' && (
              <div className="snippet">Trecho de origem: {item.provenance.sourceSnippet}</div>
            )}
            {expanded && <div style={{ marginTop: 8 }}>{props.render(item, (patch) => setItem(item.id, patch))}</div>}
          </div>
        );
      })}
    </Section>
  );
}
