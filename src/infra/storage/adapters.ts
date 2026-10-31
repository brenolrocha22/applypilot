/** Armazenamento chave-valor assíncrono. Permite trocar chrome.storage por memória (testes) ou, no futuro, um backend. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  bytesInUse?(): Promise<number | null>;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.has(key) ? (structuredClone(this.data.get(key)) as T) : undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
}

/** chrome.storage.local: persistente, isolado por extensão, não sincronizado com a conta Google. */
export class ChromeLocalStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
  async clear(): Promise<void> {
    await chrome.storage.local.clear();
  }
  async bytesInUse(): Promise<number | null> {
    return chrome.storage.local.getBytesInUse ? chrome.storage.local.getBytesInUse(null) : null;
  }
}

/** Fallback para abrir as páginas fora da extensão (ex.: `vite preview`) durante o desenvolvimento. */
export class BrowserLocalStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
  async clear(): Promise<void> {
    for (const k of Object.keys(localStorage)) if (k.startsWith('applypilot.')) localStorage.removeItem(k);
  }
}

export function createDefaultStore(): KeyValueStore {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return new ChromeLocalStore();
  if (typeof localStorage !== 'undefined') return new BrowserLocalStore();
  return new MemoryStore();
}
