/**
 * Leitor ZIP mínimo (somente leitura de uma entrada), suficiente para DOCX.
 * Evita uma dependência extra: usa DecompressionStream('deflate-raw'), disponível no Chrome e no Node 18+.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** Limite contra "zip bombs": o document.xml de um currículo é muito menor que isso. */
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65557);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Conteúdo descompactado excede o limite permitido.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

/** Lista as entradas do diretório central (sem descompactar nada). */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Arquivo ZIP inválido ou corrompido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== CEN_SIG) throw new Error('Diretório central do ZIP inválido.');
    const nameLen = view.getUint16(p + 28, true);
    entries.push({
      method: view.getUint16(p + 10, true),
      compSize: view.getUint32(p + 20, true),
      uncompSize: view.getUint32(p + 24, true),
      localOffset: view.getUint32(p + 42, true),
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, e: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.uncompSize > maxBytes) throw new Error('Conteúdo descompactado excede o limite permitido.');
  if (view.getUint32(e.localOffset, true) !== LOC_SIG) throw new Error('Cabeçalho local do ZIP inválido.');
  const dataStart = e.localOffset + 30 + view.getUint16(e.localOffset + 26, true) + view.getUint16(e.localOffset + 28, true);
  const data = bytes.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 0) return data.slice();
  if (e.method === 8) return inflateRaw(data, maxBytes);
  throw new Error(`Método de compressão ZIP não suportado (${e.method}).`);
}

export async function readZipEntry(bytes: Uint8Array, entryName: string, maxBytes = MAX_ENTRY_BYTES): Promise<Uint8Array | null> {
  const entry = listZipEntries(bytes).find((e) => e.name === entryName);
  return entry ? readEntry(bytes, entry, maxBytes) : null;
}

/** Lê como texto (UTF-8) as entradas aceitas pelo filtro, com limite total contra zip bombs. */
export async function readZipTextEntries(
  bytes: Uint8Array,
  accept: (name: string) => boolean,
  maxTotalBytes = MAX_ENTRY_BYTES,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let total = 0;
  const decoder = new TextDecoder();
  for (const e of listZipEntries(bytes)) {
    if (e.name.endsWith('/') || !accept(e.name)) continue;
    total += e.uncompSize;
    if (total > maxTotalBytes) throw new Error('Conteúdo descompactado excede o limite permitido.');
    out[e.name] = decoder.decode(await readEntry(bytes, e, maxTotalBytes));
  }
  return out;
}
