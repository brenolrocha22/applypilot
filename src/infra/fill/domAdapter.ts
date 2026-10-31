import type { AttachableFile, FieldDescriptor, FillLog, FillLogEntry, FillPlanItem } from '../../core/fill/types';

/**
 * Ponte entre o DOM e o motor de preenchimento.
 * Pode ser usado numa página da extensão (formulário de demonstração) ou, no futuro, num content script.
 * Nunca envia o formulário, nunca clica em botões e não interage com CAPTCHAs.
 */

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

function labelFor(el: FormElement, doc: Document): string {
  const parts: string[] = [];
  if (el.id) {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&');
    const lbl = doc.querySelector(`label[for="${escaped}"]`);
    if (lbl?.textContent) parts.push(lbl.textContent);
  }
  const wrapping = el.closest('label');
  if (wrapping && !parts.length) {
    // Ignora o texto de controles dentro do rótulo (ex.: opções de um <select>).
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select, textarea, input, option').forEach((n) => n.remove());
    if (clone.textContent) parts.push(clone.textContent);
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const t = doc.getElementById(id)?.textContent;
      if (t) parts.push(t);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').replace(/\*/g, '').trim().slice(0, 200);
}

export interface CollectedFields {
  descriptors: FieldDescriptor[];
  elements: Map<string, FormElement>;
}

export function collectFields(root: ParentNode, doc: Document = document): CollectedFields {
  const elements = new Map<string, FormElement>();
  const descriptors: FieldDescriptor[] = [];
  const nodes = root.querySelectorAll<FormElement>('input, textarea, select');
  nodes.forEach((el, i) => {
    const tag = el.tagName.toLowerCase() as FieldDescriptor['tag'];
    const type = tag === 'input' ? ((el as HTMLInputElement).getAttribute('type') ?? '').toLowerCase() : tag;
    if (tag === 'input' && SKIPPED_INPUT_TYPES.has(type)) return;
    const key = `field-${i}`;
    elements.set(key, el);
    descriptors.push({
      key,
      tag,
      type: tag === 'input' ? type : tag,
      name: el.getAttribute('name') ?? '',
      id: el.id,
      label: labelFor(el, doc),
      placeholder: el.getAttribute('placeholder') ?? '',
      autocomplete: el.getAttribute('autocomplete') ?? '',
      ariaLabel: el.getAttribute('aria-label') ?? '',
      // O valor de campos de senha nunca é lido.
      currentValue: type === 'password' ? '' : tag === 'select' ? ((el as HTMLSelectElement).selectedIndex > 0 ? el.value : '') : el.value,
      options: tag === 'select' ? Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, label: o.textContent?.trim() ?? '' })) : [],
      required: el.required,
      disabled: el.disabled || (el as HTMLInputElement).readOnly === true,
      accept: type === 'file' ? (el.getAttribute('accept') ?? '') : undefined,
    });
  });
  return { descriptors, elements };
}

/** Define o valor de forma compatível com frameworks (React/Vue observam o setter nativo e eventos). */
function setNativeValue(el: FormElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Anexa um arquivo guardado a um <input type="file"> (o mesmo que o usuário escolher o arquivo). */
function attachFile(el: FormElement, file: AttachableFile): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') return false;
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], file.name, { type: file.type, lastModified: Date.parse(file.savedAt) || Date.now() }));
  el.files = dt.files;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.files?.[0]?.name === file.name;
}

/**
 * Aplica somente os itens aprovados pelo usuário e devolve o registro da operação.
 * Itens "skip_has_value" só são aplicados se aprovados explicitamente (substituição consciente).
 */
export function applyFillPlan(
  plan: FillPlanItem[],
  approvedKeys: Set<string>,
  elements: Map<string, FormElement>,
  page: string,
  id: string,
  files: { resumeFile?: AttachableFile | null } = {},
): FillLog {
  const entries: FillLogEntry[] = [];
  for (const item of plan) {
    const base = { fieldKey: item.field.key, fieldLabel: item.field.label || item.field.name || item.field.id, profileField: item.profileField, action: item.action };
    const canApply = (item.action === 'fill' || item.action === 'skip_has_value') && item.value !== null;
    if (!approvedKeys.has(item.field.key) || !canApply) {
      entries.push({ ...base, result: 'skipped', message: approvedKeys.has(item.field.key) ? 'Nada a preencher.' : 'Não aprovado.' });
      continue;
    }
    const el = elements.get(item.field.key);
    if (!el || !el.isConnected) {
      entries.push({ ...base, result: 'failed', message: 'Campo não encontrado na página.' });
      continue;
    }
    if (item.profileField === 'resumeFile') {
      const ok = !!files.resumeFile && attachFile(el, files.resumeFile);
      if (ok) el.setAttribute('data-applypilot-filled', 'true');
      entries.push(ok ? { ...base, result: 'filled' } : { ...base, result: 'failed', message: files.resumeFile ? 'A página não aceitou o arquivo.' : 'Arquivo do currículo indisponível.' });
      continue;
    }
    setNativeValue(el, item.value!);
    if (el.value === item.value) {
      el.setAttribute('data-applypilot-filled', 'true');
      entries.push({ ...base, result: 'filled' });
    } else {
      entries.push({ ...base, result: 'failed', message: 'A página não aceitou o valor.' });
    }
  }
  return {
    id,
    timestamp: new Date().toISOString(),
    page,
    entries,
    filled: entries.filter((e) => e.result === 'filled').length,
    skipped: entries.filter((e) => e.result === 'skipped').length,
    failed: entries.filter((e) => e.result === 'failed').length,
  };
}
