/**
 * Cofre: cópia de segurança de todos os dados, criptografada com uma senha escolhida pelo usuário.
 * AES-256-GCM com chave derivada da senha por PBKDF2-SHA-256 (WebCrypto, sem rede).
 * A senha nunca é armazenada; sem ela o arquivo não pode ser aberto.
 */

export const VAULT_FORMAT = 'applypilot-vault';
export const VAULT_EXTENSION = '.applypilot';
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 10;
/** Limites para arquivos recebidos (dado não confiável): evita custo de derivação abusivo. */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 5_000_000;
export const MAX_VAULT_BYTES = 10 * 1024 * 1024;

export interface VaultFile {
  format: typeof VAULT_FORMAT;
  version: 1;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

export function passwordProblems(password: string, confirmation: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  if (password !== confirmation) problems.push('A confirmação não confere com a senha.');
  return problems;
}

const toB64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function lockVault(payload: unknown, password: string, iterations = DEFAULT_ITERATIONS, now = new Date()): Promise<VaultFile> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    format: VAULT_FORMAT,
    version: 1,
    createdAt: now.toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(data),
  };
}

/** Abre um arquivo do cofre. Retorna o conteúdo ainda não validado (o chamador faz a coerção). */
export async function unlockVault(text: string, password: string): Promise<unknown> {
  let file: VaultFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('Arquivo do cofre inválido.');
  }
  if (file?.format !== VAULT_FORMAT || file.version !== 1) throw new Error('Este arquivo não é um cofre do ApplyPilot.');
  const iterations = file.kdf?.iterations;
  if (file.kdf?.name !== 'PBKDF2' || file.kdf.hash !== 'SHA-256' || file.cipher?.name !== 'AES-GCM') throw new Error('Formato de criptografia não suportado.');
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Parâmetros de criptografia fora do esperado.');
  let salt: Uint8Array, iv: Uint8Array, data: Uint8Array;
  try {
    salt = fromB64(file.kdf.salt);
    iv = fromB64(file.cipher.iv);
    data = fromB64(file.data);
  } catch {
    throw new Error('Arquivo do cofre corrompido.');
  }
  if (iv.length !== 12 || salt.length < 16) throw new Error('Arquivo do cofre corrompido.');
  const key = await deriveKey(password, salt, iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    throw new Error('Senha incorreta ou arquivo alterado.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
