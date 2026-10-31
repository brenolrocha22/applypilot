import { describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { listZipEntries, readZipTextEntries } from '../../src/infra/documents/zip';
import { readLinkedInExport, zipLooksLikeLinkedInExport } from '../../src/infra/documents/linkedin';
import { processBatch } from '../../src/infra/documents/batch';
import { ChromeLocalStore, MemoryStore } from '../../src/infra/storage/adapters';
import { Repository, STORAGE_KEYS } from '../../src/infra/storage/repository';
import { LINKEDIN_FILES, makeProfile } from '../fixtures/data';

/** ZIP com várias entradas (deflate), montado em memória. */
function buildZip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const EXPORT_ZIP = buildZip({ ...LINKEDIN_FILES, 'messages.csv': 'CONVERSATION ID,CONTENT\n1,mensagem privada\n' });

describe('zip com várias entradas', () => {
  it('lista e lê só as entradas aceitas', async () => {
    expect(listZipEntries(EXPORT_ZIP).map((e) => e.name)).toContain('Positions.csv');
    const files = await readZipTextEntries(EXPORT_ZIP, (n) => n === 'Skills.csv');
    expect(Object.keys(files)).toEqual(['Skills.csv']);
    await expect(readZipTextEntries(EXPORT_ZIP, () => true, 100)).rejects.toThrow(/limite/);
  });
});

describe('leitura do .zip do LinkedIn', () => {
  it('reconhece e converte em rascunho, sem ler mensagens', async () => {
    expect(zipLooksLikeLinkedInExport(EXPORT_ZIP)).toBe(true);
    const d = await readLinkedInExport(EXPORT_ZIP);
    expect(d.personal.fullName?.value).toBe('Ana Exemplo');
    expect(JSON.stringify(d)).not.toContain('mensagem privada');
  });

  it('recusa .zip que não é exportação do LinkedIn', async () => {
    const other = buildZip({ 'foto.txt': 'x' });
    expect(zipLooksLikeLinkedInExport(other)).toBe(false);
    await expect(readLinkedInExport(other)).rejects.toThrow(/não parece/);
  });

  it('é encontrado dentro da pasta importada', async () => {
    const r = await processBatch(
      [
        { path: 'Pasta/Basic_LinkedInDataExport.zip', size: EXPORT_ZIP.length, lastModified: 1, read: async () => EXPORT_ZIP },
        { path: 'Pasta/outro.zip', size: 10, lastModified: 1, read: async () => buildZip({ 'a.txt': 'a' }) },
      ],
      'Ana Exemplo',
      { pdfPages: async () => [], docx: async () => '', linkedin: async (b) => (zipLooksLikeLinkedInExport(b) ? readLinkedInExport(b) : null) },
    );
    expect(r.linkedin?.path).toBe('Pasta/Basic_LinkedInDataExport.zip');
    expect(r.linkedin?.draft.experiences).toHaveLength(2);
    expect(r.ignoredCount).toBe(1);
  });
});

describe('perfil atualizado entre abas', () => {
  it('avisa quem está inscrito quando o perfil é salvo e devolve a versão gravada', async () => {
    const repo = new Repository(new MemoryStore());
    const cb = vi.fn();
    const off = repo.onProfileChange(cb);
    const version = await repo.saveProfile(makeProfile());
    expect(cb).toHaveBeenCalledTimes(1);
    expect((await repo.loadProfile())?.updatedAt).toBe(version);
    off();
    await repo.saveProfile(makeProfile());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('usa chrome.storage.onChanged e filtra pela chave do perfil', () => {
    const listeners: ((c: Record<string, unknown>, area: string) => void)[] = [];
    vi.stubGlobal('chrome', { storage: { local: {}, onChanged: { addListener: (l: never) => listeners.push(l), removeListener: vi.fn() } } });
    const cb = vi.fn();
    new Repository(new ChromeLocalStore()).onProfileChange(cb);
    listeners[0]!({ [STORAGE_KEYS.jobs]: {} }, 'local');
    listeners[0]!({ [STORAGE_KEYS.profile]: {} }, 'sync');
    expect(cb).not.toHaveBeenCalled();
    listeners[0]!({ [STORAGE_KEYS.profile]: {} }, 'local');
    expect(cb).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
