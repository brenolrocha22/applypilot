/**
 * Agente injetado sob demanda (chrome.scripting) na aba ativa, somente após o clique do usuário
 * na extensão (permissão activeTab). Roda no "isolated world": scripts da página não acessam este código.
 * Não envia formulários, não clica em botões, não lê senhas e não faz requisições de rede.
 */
import type { FieldDescriptor, FillLog, FillPlanItem } from '../core/fill/types';
import { applyFillPlan, collectFields, type CollectedFields } from '../infra/fill/domAdapter';
import { extractJobFromDocument, type ExtractedJobPage } from '../infra/page/jobExtractor';

export interface ApplyPilotAgent {
  version: string;
  extractJob(): ExtractedJobPage;
  collectFields(): { descriptors: FieldDescriptor[]; page: string; frameCount: number };
  applyPlan(plan: FillPlanItem[], approvedKeys: string[], logId: string): FillLog;
}

declare global {
  // eslint-disable-next-line no-var
  var __applypilotAgent: ApplyPilotAgent | undefined;
}

const AGENT_VERSION = '0.2.0';

if (!globalThis.__applypilotAgent || globalThis.__applypilotAgent.version !== AGENT_VERSION) {
  let collected: CollectedFields | null = null;
  /** Página sem query string nem fragmento (evita gravar tokens/IDs pessoais da URL no registro). */
  const pageId = () => `${location.origin}${location.pathname}`;

  globalThis.__applypilotAgent = {
    version: AGENT_VERSION,
    extractJob() {
      return extractJobFromDocument(document, pageId(), window.getSelection()?.toString() ?? '');
    },
    collectFields() {
      collected = collectFields(document);
      return { descriptors: collected.descriptors, page: pageId(), frameCount: document.querySelectorAll('iframe').length };
    },
    applyPlan(plan, approvedKeys, logId) {
      if (!collected) collected = collectFields(document);
      return applyFillPlan(plan, new Set(approvedKeys), collected.elements, pageId(), logId);
    },
  };
}
