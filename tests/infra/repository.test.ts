import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromeLocalStore, MemoryStore } from '../../src/infra/storage/adapters';
import { MAX_FILL_LOGS, Repository, STORAGE_KEYS } from '../../src/infra/storage/repository';
import { analyzeJob } from '../../src/core/fit/engine';
import type { SavedJob } from '../../src/core/model/job';
import { DEFAULT_DIMENSION_WEIGHTS } from '../../src/core/fit/weights';
import { JOB, makeProfile, NOW, REFERENCE_DATE } from '../fixtures/data';

function makeJob(id: string, createdAt = NOW): SavedJob {
  const { parsed, report } = analyzeJob(makeProfile(), JOB, { referenceDate: REFERENCE_DATE, now: NOW });
  return { id, input: JOB, parsed, report, status: 'analyzed', notes: '', createdAt, updatedAt: createdAt };
}

describe('Repository (persistência local)', () => {
  let repo: Repository;
  beforeEach(() => {
    repo = new Repository(new MemoryStore());
  });

  it('salva e recupera o perfil', async () => {
    expect(await repo.loadProfile()).toBeNull();
    const p = makeProfile();
    await repo.saveProfile(p);
    const loaded = await repo.loadProfile();
    expect(loaded?.personal.fullName).toBe(p.personal.fullName);
    expect(loaded?.experiences).toEqual(p.experiences);
  });

  it('salva, lista (mais recente primeiro), atualiza e exclui vagas', async () => {
    await repo.saveJob(makeJob('a', '2026-01-01T00:00:00.000Z'));
    await repo.saveJob(makeJob('b', '2026-01-02T00:00:00.000Z'));
    expect((await repo.listJobs()).map((j) => j.id)).toEqual(['b', 'a']);
    const updated = await repo.updateJob('a', { status: 'applied', notes: 'Enviado' });
    expect(updated?.status).toBe('applied');
    expect((await repo.getJob('a'))?.notes).toBe('Enviado');
    await repo.deleteJob('b');
    expect((await repo.listJobs()).map((j) => j.id)).toEqual(['a']);
  });

  it('o relatório salvo é preservado integralmente (rastreabilidade das evidências)', async () => {
    const job = makeJob('x');
    await repo.saveJob(job);
    expect((await repo.getJob('x'))?.report).toEqual(job.report);
  });

  it('configurações: pesos inválidos são recusados e o padrão é usado', async () => {
    expect((await repo.getSettings()).weights).toEqual(DEFAULT_DIMENSION_WEIGHTS);
    await expect(repo.saveSettings({ weights: { ...DEFAULT_DIMENSION_WEIGHTS, technical: -1 } })).rejects.toThrow();
    await repo.saveSettings({ weights: { ...DEFAULT_DIMENSION_WEIGHTS, culture: 0 } });
    expect((await repo.getSettings()).weights.culture).toBe(0);
  });

  it('mantém apenas os registros de preenchimento mais recentes', async () => {
    for (let i = 0; i < MAX_FILL_LOGS + 5; i++) {
      await repo.addFillLog({ id: `l${i}`, timestamp: NOW, page: 'demo', entries: [], filled: 0, skipped: 0, failed: 0 });
    }
    const logs = await repo.listFillLogs();
    expect(logs).toHaveLength(MAX_FILL_LOGS);
    expect(logs[0]!.id).toBe(`l${MAX_FILL_LOGS + 4}`);
  });

  it('exporta e reimporta o perfil; JSON inválido gera erro legível', async () => {
    await repo.saveProfile(makeProfile());
    const bundle = await repo.exportAll();
    expect(bundle.format).toBe('applypilot-export');
    const imported = repo.parseProfileImport(JSON.stringify(bundle));
    expect(imported.personal.email).toBe('ana.exemplo@example.com');
    expect(() => repo.parseProfileImport('{oops')).toThrow(/JSON inválido/);
    expect(() => repo.parseProfileImport(JSON.stringify({ format: 'applypilot-export', profile: null }))).toThrow(/não contém/);
  });

  it('exclui todos os dados locais', async () => {
    await repo.saveProfile(makeProfile());
    await repo.saveJob(makeJob('a'));
    await repo.clearAll();
    expect(await repo.loadProfile()).toBeNull();
    expect(await repo.listJobs()).toEqual([]);
  });
});

describe('ChromeLocalStore', () => {
  it('usa chrome.storage.local', async () => {
    const data: Record<string, unknown> = {};
    const local = {
      get: vi.fn(async (k: string) => ({ [k]: data[k] })),
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(data, o)),
      remove: vi.fn(async (k: string) => void delete data[k]),
      clear: vi.fn(async () => undefined),
      getBytesInUse: vi.fn(async () => 123),
    };
    vi.stubGlobal('chrome', { storage: { local } });
    const repo = new Repository(new ChromeLocalStore());
    await repo.saveProfile(makeProfile());
    expect(local.set).toHaveBeenCalledWith({ [STORAGE_KEYS.profile]: expect.any(Object) });
    expect((await repo.loadProfile())?.personal.fullName).toBe('Ana Exemplo da Silva');
    expect(await repo.bytesInUse()).toBe(123);
    vi.unstubAllGlobals();
  });
});
