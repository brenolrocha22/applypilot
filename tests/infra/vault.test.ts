import { describe, expect, it } from 'vitest';
import { lockVault, passwordProblems, unlockVault } from '../../src/infra/storage/vault';
import { MemoryStore } from '../../src/infra/storage/adapters';
import { Repository } from '../../src/infra/storage/repository';
import { makeProfile } from '../fixtures/data';

const PASS = 'frase longa de teste 123';
const FAST = 100_000; // mínimo aceito; mantém o teste rápido

describe('cofre protegido por senha', () => {
  it('criptografa e abre com a senha certa', async () => {
    const vault = await lockVault({ segredo: 'ana@example.com' }, PASS, FAST);
    const text = JSON.stringify(vault);
    expect(text).not.toContain('ana@example.com');
    expect(vault.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: FAST });
    expect(await unlockVault(text, PASS)).toEqual({ segredo: 'ana@example.com' });
  });

  it('recusa senha errada, arquivo alterado e parâmetros fora do limite', async () => {
    const vault = await lockVault({ a: 1 }, PASS, FAST);
    await expect(unlockVault(JSON.stringify(vault), 'senha errada 000')).rejects.toThrow(/Senha incorreta/);
    const tampered = { ...vault, data: vault.data.slice(0, -4) + (vault.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    await expect(unlockVault(JSON.stringify(tampered), PASS)).rejects.toThrow(/Senha incorreta|corrompido/);
    await expect(unlockVault(JSON.stringify({ ...vault, kdf: { ...vault.kdf, iterations: 1e9 } }), PASS)).rejects.toThrow(/fora do esperado/);
    await expect(unlockVault('{"format":"outro"}', PASS)).rejects.toThrow(/não é um cofre/);
  });

  it('exige senha forte e confirmação igual', async () => {
    expect(passwordProblems('curta', 'curta')).toHaveLength(1);
    expect(passwordProblems(PASS, PASS + 'x')).toHaveLength(1);
    expect(passwordProblems(PASS, PASS)).toEqual([]);
    await expect(lockVault({}, 'curta', FAST)).rejects.toThrow(/pelo menos/);
  });

  it('guarda e restaura perfil, vagas e o arquivo do currículo', async () => {
    const source = new Repository(new MemoryStore());
    await source.saveProfile(makeProfile());
    await source.saveResumeFile({ name: 'cv.pdf', type: 'application/pdf', size: 3, base64: 'AQID', savedAt: '2026-10-31T00:00:00.000Z' });
    const vault = await lockVault(await source.exportAll(), PASS, FAST);

    const target = new Repository(new MemoryStore());
    const r = await target.restoreAll(await unlockVault(JSON.stringify(vault), PASS));
    expect(r).toEqual({ profile: true, jobs: 0, resumeFile: true });
    expect((await target.loadProfile())?.personal.fullName).toBe(makeProfile().personal.fullName);
    expect((await target.loadResumeFile())?.name).toBe('cv.pdf');
    await expect(target.restoreAll({ format: 'x' })).rejects.toThrow(/não é um pacote/);
  });

  it('recusa arquivo de currículo grande demais', async () => {
    const repo = new Repository(new MemoryStore());
    await expect(repo.saveResumeFile({ name: 'a.pdf', type: 'application/pdf', size: 4 * 1024 * 1024, base64: '', savedAt: '' })).rejects.toThrow(/MB/);
  });
});
