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

export async function readZipEntry(bytes: Uint8Array, entryName: string, maxBytes = MAX_ENTRY_BYTES): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Arquivo ZIP inválido ou corrompido.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== CEN_SIG) throw new Error('Diretório central do ZIP inválido.');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== entryName) continue;

    if (uncompSize > maxBytes) throw new Error('Conteúdo descompactado excede o limite permitido.');
    if (view.getUint32(localOffset, true) !== LOC_SIG) throw new Error('Cabeçalho local do ZIP inválido.');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) return data.slice();
    if (method === 8) return inflateRaw(data, maxBytes);
    throw new Error(`Método de compressão ZIP não suportado (${method}).`);
  }
  return null;
}
