import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { validateResumeFile, MAX_RESUME_BYTES } from '../../src/infra/documents/validate';
import { readZipEntry } from '../../src/infra/documents/zip';
import { docxXmlToText, extractDocxText } from '../../src/infra/documents/docx';

/** Monta um ZIP mínimo em memória (uma entrada) para testar o leitor sem arquivos binários no repositório. */
function buildZip(name: string, content: string, method: 0 | 8 = 8): Uint8Array {
  const raw = Buffer.from(content, 'utf8');
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return new Uint8Array(Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]));
}

const DOC_XML = `<?xml version="1.0"?><w:document><w:body>
<w:p><w:r><w:t>Maria Fictícia</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Habilidades: </w:t></w:r><w:r><w:t>Python &amp; SQL</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Item de lista</w:t></w:r></w:p>
<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>
</w:body></w:document>`;

describe('validateResumeFile', () => {
  const pdfHead = new TextEncoder().encode('%PDF-1.7');
  const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  it('aceita PDF, DOCX e TXT com conteúdo correspondente', () => {
    expect(validateResumeFile({ name: 'cv.PDF', size: 100 }, pdfHead)).toEqual({ ok: true, kind: 'pdf' });
    expect(validateResumeFile({ name: 'cv.docx', size: 100 }, zipHead)).toEqual({ ok: true, kind: 'docx' });
    expect(validateResumeFile({ name: 'cv.txt', size: 100 }, new TextEncoder().encode('Nome'))).toEqual({ ok: true, kind: 'txt' });
  });
  it('rejeita extensão falsa, tamanho excessivo, vazio e formatos não suportados', () => {
    expect(validateResumeFile({ name: 'cv.pdf', size: 100 }, zipHead).ok).toBe(false);
    expect(validateResumeFile({ name: 'cv.pdf', size: MAX_RESUME_BYTES + 1 }, pdfHead).ok).toBe(false);
    expect(validateResumeFile({ name: 'cv.pdf', size: 0 }, pdfHead).ok).toBe(false);
    expect(validateResumeFile({ name: 'cv.exe', size: 10 }, pdfHead).ok).toBe(false);
    expect(validateResumeFile({ name: 'cv.doc', size: 10 }, pdfHead).error).toMatch(/docx/);
  });
});

describe('leitor ZIP e DOCX', () => {
  it('lê entradas comprimidas e armazenadas', async () => {
    for (const method of [0, 8] as const) {
      const zip = buildZip('word/document.xml', 'olá mundo', method);
      const out = await readZipEntry(zip, 'word/document.xml');
      expect(new TextDecoder().decode(out!)).toBe('olá mundo');
      expect(await readZipEntry(zip, 'outro.xml')).toBeNull();
    }
  });

  it('recusa conteúdo acima do limite (proteção contra zip bomb)', async () => {
    const zip = buildZip('word/document.xml', 'x'.repeat(5000));
    await expect(readZipEntry(zip, 'word/document.xml', 1000)).rejects.toThrow(/limite/);
  });

  it('recusa arquivo que não é ZIP', async () => {
    await expect(readZipEntry(new Uint8Array(100), 'a')).rejects.toThrow();
  });

  it('converte o XML do Word em texto, com parágrafos, listas, tabs e entidades', async () => {
    expect(docxXmlToText(DOC_XML)).toBe('Maria Fictícia\nHabilidades: Python & SQL\n• Item de lista\nA\tB\nC');
    const text = await extractDocxText(buildZip('word/document.xml', DOC_XML));
    expect(text).toContain('Python & SQL');
  });
});
