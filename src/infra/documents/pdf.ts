/**
 * Extração de texto de PDF com pdf.js, carregado sob demanda (mantém o bundle inicial pequeno).
 * O worker é empacotado na própria extensão (CSP do MV3 não permite scripts remotos).
 * `isEvalSupported: false` evita uso de eval; scripts embutidos no PDF nunca são executados.
 */
export async function extractPdfPages(bytes: Uint8Array, maxPages = 30): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // pdf.js transfere o buffer para o worker; usamos uma cópia para não invalidar o original.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
        text += item.str;
        if (item.hasEOL) text += '\n';
        lastY = y;
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export async function extractPdfText(bytes: Uint8Array, maxPages = 30): Promise<string> {
  return (await extractPdfPages(bytes, maxPages)).join('\n').trim();
}
