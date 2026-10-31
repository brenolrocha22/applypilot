/**
 * Lê os nomes das competências da página "Competências" do LinkedIn (linkedin.com/in/<perfil>/details/skills/).
 * Cada competência é um item de lista cujo primeiro texto visível é o nome; endossos e experiências
 * associadas vêm em subitens e são descartados depois (cleanSkillNames).
 */
export function extractLinkedInSkillTexts(doc: Document): string[] {
  const root = doc.querySelector('main') ?? doc.body;
  const texts: string[] = [];
  root.querySelectorAll('li').forEach((li) => {
    // O LinkedIn repete o texto: uma cópia visível (aria-hidden) e outra só para leitores de tela.
    const span = li.querySelector('span[aria-hidden="true"]') ?? li.querySelector('span, div');
    const t = (span?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) texts.push(t);
  });
  return texts;
}
