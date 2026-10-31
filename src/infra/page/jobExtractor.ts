import { MAX_DESCRIPTION_LENGTH } from '../../core/job/limits';

/**
 * Extrai a descrição de uma vaga do documento da página atual.
 * Ordem: texto selecionado pelo usuário → dados estruturados schema.org JobPosting (JSON-LD)
 * → conteúdo principal (main/article) → corpo da página.
 * O conteúdo da página é dado não confiável: só texto é retornado; nada é executado.
 */

export type JobPageSource = 'selection' | 'structured_data' | 'main_content' | 'page_body';

export interface ExtractedJobPage {
  title: string;
  company: string;
  url: string;
  description: string;
  source: JobPageSource;
  truncated: boolean;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'TR', 'BLOCKQUOTE']);

/** Converte HTML (descrição do JSON-LD) em texto, preservando parágrafos e itens de lista. */
export function htmlToText(html: string): string {
  // DOMParser cria um documento inerte: scripts não são executados e recursos não são carregados.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (el.tagName === 'LI') out += '\n- ';
    else if (BLOCK_TAGS.has(el.tagName)) out += '\n';
    el.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(el.tagName) && el.tagName !== 'LI') out += '\n';
  };
  parsed.body.childNodes.forEach(walk);
  return out
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function findJobPostings(data: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(data)) data.forEach((d) => findJobPostings(d, out));
  else if (isObj(data)) {
    const type = data['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(data);
    if (data['@graph']) findJobPostings(data['@graph'], out);
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function fromStructuredData(doc: Document): Omit<ExtractedJobPage, 'url' | 'truncated'> | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const posting = findJobPostings(data)[0];
    if (!posting) continue;
    const description = htmlToText(str(posting.description));
    if (description.length < 50) continue;
    const org = posting.hiringOrganization;
    const company = isObj(org) ? str(org.name) : str(org);
    // Complementa com modalidade e local, que costumam estar fora do texto da descrição.
    const extras: string[] = [];
    if (str(posting.jobLocationType).toUpperCase() === 'TELECOMMUTE') extras.push('Modelo de trabalho: remoto');
    const locs = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
    const places = locs
      .map((l) => (isObj(l) && isObj(l.address) ? [str(l.address.addressLocality), str(l.address.addressRegion)].filter(Boolean).join(' - ') : ''))
      .filter(Boolean);
    if (places.length) extras.push(`Local: ${places[0]}`);
    return {
      title: str(posting.title),
      company,
      description: extras.length ? `${description}\n\n${extras.join('\n')}` : description,
      source: 'structured_data',
    };
  }
  return null;
}

function visibleText(el: Element): string {
  const html = el as HTMLElement;
  // innerText respeita o layout (oculta elementos invisíveis); textContent é o fallback (ex.: jsdom).
  return (typeof html.innerText === 'string' && html.innerText ? html.innerText : el.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractJobFromDocument(doc: Document, url: string, selection = ''): ExtractedJobPage {
  const pageTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || doc.querySelector('h1')?.textContent?.trim() || doc.title.trim();
  const finish = (r: Omit<ExtractedJobPage, 'url' | 'truncated'>): ExtractedJobPage => ({
    ...r,
    title: r.title.slice(0, 200),
    company: r.company.slice(0, 200),
    url,
    description: r.description.slice(0, MAX_DESCRIPTION_LENGTH),
    truncated: r.description.length > MAX_DESCRIPTION_LENGTH,
  });

  if (selection.trim().length >= 200) {
    return finish({ title: pageTitle, company: '', description: selection.trim(), source: 'selection' });
  }
  const structured = fromStructuredData(doc);
  if (structured) return finish({ ...structured, title: structured.title || pageTitle });

  const main = doc.querySelector('main, [role="main"], article');
  const mainText = main ? visibleText(main) : '';
  if (mainText.length >= 300) return finish({ title: pageTitle, company: '', description: mainText, source: 'main_content' });
  return finish({ title: pageTitle, company: '', description: visibleText(doc.body), source: 'page_body' });
}
