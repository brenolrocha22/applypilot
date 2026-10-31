// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isCandidate, processBatch, type BatchFile } from '../../src/infra/documents/batch';
import { extractJobFromDocument, htmlToText } from '../../src/infra/page/jobExtractor';
import { MemoryStore } from '../../src/infra/storage/adapters';
import { Repository } from '../../src/infra/storage/repository';

const enc = (s: string) => new TextEncoder().encode(s);
const file = (path: string, content: string | Uint8Array): BatchFile => {
  const bytes = typeof content === 'string' ? enc(content) : content;
  return { path, size: bytes.length, lastModified: 0, read: async () => bytes };
};
// PDFs falsos: o extrator injetado devolve as "páginas" conforme o conteúdo após o cabeçalho.
const fakePdf = (pages: string[]) => enc(`%PDF-1.4\n${JSON.stringify(pages)}`);
const extractors = {
  pdfPages: async (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b).slice(9)) as string[],
  docx: async () => '',
};

describe('processBatch', () => {
  it('ignora arquivos que não são documentos e pastas de páginas salvas', () => {
    expect(isCandidate('a/b.css')).toBeNull();
    expect(isCandidate('Mapa_files/x.png')).toBeNull();
    expect(isCandidate('a/b.exe')).toBeNull();
    expect(isCandidate('a/cert.webp')).toBe('image');
    expect(isCandidate('a/cert.PDF')).toBe('document');
  });

  it('separa currículos, certificados (texto e imagem) e documentos não usados', async () => {
    const r = await processBatch(
      [
        file('Pasta/estilo.css', 'body{}'),
        file('Pasta/Curso X (Escola Y, 2024).pdf', fakePdf(['ANA SILVA\nCurso de Excel Avançado\n20 horas\nJunho de 2024'])),
        file('Pasta/Modulo Python.webp', 'img'),
        file('Pasta/escaneado.pdf', fakePdf([''])),
        file('Carreira/Curriculo Ana.pdf', fakePdf(['EXPERIÊNCIA\nAnalista · Empresa 01/2020 - 02/2021\nFORMAÇÃO\nBacharelado'])),
        file('Estudos/Guia.pdf', fakePdf(['Um guia longo sem certificado algum.'.repeat(3)])),
        file('Pasta/falso.pdf', 'não é pdf'),
      ],
      'Ana Silva',
      extractors,
    );
    expect(r.ignoredCount).toBe(1);
    expect(r.resumes.map((x) => x.path)).toEqual(['Carreira/Curriculo Ana.pdf']);
    expect(r.certificates.map((c) => [c.name, c.basis])).toEqual([
      ['Excel Avançado', 'text'],
      ['Modulo Python', 'file_name'],
      ['escaneado', 'file_name'],
    ]);
    expect(r.skipped.map((s) => s.path)).toEqual(['Estudos/Guia.pdf', 'Pasta/falso.pdf']);
  });
});

describe('extração da vaga na página', () => {
  const setDoc = (html: string) => {
    document.documentElement.innerHTML = html;
    return document;
  };

  it('usa dados estruturados JobPosting (inclusive dentro de @graph), com modalidade e local', () => {
    const ld = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'X' },
        {
          '@type': 'JobPosting',
          title: 'Analista de Dados Jr',
          hiringOrganization: { '@type': 'Organization', name: 'Empresa Fictícia' },
          jobLocationType: 'TELECOMMUTE',
          jobLocation: { address: { addressLocality: 'Recife', addressRegion: 'PE' } },
          description: '<p>Requisitos:</p><ul><li>Python</li><li>SQL</li></ul><script>alert(1)</script><p>Diferenciais: Power BI e muito mais texto para passar do limite mínimo.</p>',
        },
      ],
    };
    // Sites escapam "<" no JSON-LD para não fechar a tag <script> (como fazemos aqui).
    const json = JSON.stringify(ld).replace(/</g, '\\u003c');
    const doc = setDoc(`<head><title>Vaga</title><script type="application/ld+json">${json}</script></head><body><nav>Menu</nav></body>`);
    const r = extractJobFromDocument(doc, 'https://exemplo.com/vaga');
    expect(r).toMatchObject({ source: 'structured_data', title: 'Analista de Dados Jr', company: 'Empresa Fictícia' });
    expect(r.description).toContain('Requisitos:\n\n- Python\n- SQL');
    expect(r.description).toContain('Modelo de trabalho: remoto');
    expect(r.description).toContain('Local: Recife - PE');
    expect(r.description).not.toContain('alert');
  });

  it('prioriza o texto selecionado pelo usuário', () => {
    const doc = setDoc('<body><main>Conteúdo</main></body>');
    const sel = 'Requisitos: '.padEnd(250, 'x');
    expect(extractJobFromDocument(doc, 'u', sel).source).toBe('selection');
  });

  it('ignora JSON-LD inválido e usa o conteúdo principal', () => {
    const doc = setDoc(`<head><script type="application/ld+json">{quebrado</script></head><body><nav>Menu</nav><main><h1>Dev</h1>${'<p>Requisito importante da vaga.</p>'.repeat(20)}</main></body>`);
    const r = extractJobFromDocument(doc, 'u');
    expect(r.source).toBe('main_content');
    expect(r.description).not.toContain('Menu');
  });

  it('htmlToText não executa scripts e preserva listas', () => {
    expect(htmlToText('<ul><li>A</li><li>B</li></ul><img src=x onerror="window.__x=1">')).toBe('- A\n- B');
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
});

describe('vaga capturada pendente', () => {
  it('é entregue uma única vez e expira', async () => {
    const repo = new Repository(new MemoryStore());
    await repo.savePendingJob({ title: 't', company: 'c', url: 'u', description: 'd', source: 'page_body', truncated: false });
    expect((await repo.takePendingJob())?.title).toBe('t');
    expect(await repo.takePendingJob()).toBeNull();
  });
});
