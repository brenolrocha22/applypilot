/** Normaliza texto para comparação: minúsculas, sem acentos, espaços colapsados. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Igual a normalizeText, mas preserva o comprimento (1 caractere de saída por caractere de entrada)
 * e não colapsa espaços. Permite mapear posições encontradas de volta ao texto original.
 */
export function foldPreserving(input: string): string {
  let out = '';
  for (const ch of input) {
    const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Caracteres fora do BMP ocupam 2 unidades UTF-16; mantemos o mesmo comprimento.
    out += ch.length === 1 ? (folded[0] ?? ch) : ch;
  }
  return out;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Cria uma regex que encontra o termo como palavra inteira em texto já normalizado.
 * Usa limites customizados porque termos como "c++", "c#" e ".net" não funcionam com \b.
 */
export function termRegex(normalizedTerm: string, flags = 'g'): RegExp {
  return new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(normalizedTerm)}(?=$|[^a-z0-9+#])`, flags);
}

export function containsTerm(normalizedText: string, normalizedTerm: string): boolean {
  return termRegex(normalizedTerm, '').test(normalizedText);
}

const STOPWORDS = new Set(
  (
    'a o os as um uma uns umas de da do das dos e em no na nos nas para por com sem que se ao aos ' +
    'como sua seu suas seus ou mais muito ser ter sobre entre ate pelo pela pelos pelas este esta ' +
    'esse essa isso nosso nossa voce voces sera irá ira atuar atuacao experiencia conhecimento ' +
    'the of and to in for with on at by from as an be is are or our your you will we this that ' +
    'experience knowledge working work ability strong good'
  ).split(/\s+/),
);

/** Tokens significativos (sem stopwords, com 3+ caracteres). */
export function meaningfulTokens(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
