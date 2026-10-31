import { readZipEntry } from './zip';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? '';
  });
}

/**
 * Converte o XML do corpo de um DOCX em texto (um parágrafo por linha).
 * Extração por expressões regulares: funciona igual no navegador e no Node, e não interpreta
 * nenhum conteúdo ativo do documento (macros, campos, objetos incorporados são ignorados).
 */
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  return paragraphs
    .map((p) => {
      let out = '';
      const tokens = p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g) ?? [];
      for (const t of tokens) {
        if (t === '<w:tab/>') out += '\t';
        else if (t === '<w:br/>' || t === '<w:cr/>') out += '\n';
        else out += decodeXml(t.replace(/^<w:t[^>]*>|<\/w:t>$/g, ''));
      }
      const isListItem = /<w:numPr>/.test(p);
      return isListItem && out.trim() ? `• ${out}` : out;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const xml = await readZipEntry(bytes, 'word/document.xml');
  if (!xml) throw new Error('DOCX sem conteúdo principal (word/document.xml).');
  return docxXmlToText(new TextDecoder().decode(xml));
}
