import type { DimensionWeights } from '../../core/model/fit';
import type { SavedJob } from '../../core/model/job';
import type { Profile } from '../../core/model/profile';
import { coerceProfile } from '../../core/profile/validation';
import { DEFAULT_DIMENSION_WEIGHTS, validateWeights } from '../../core/fit/weights';
import type { FillLog } from '../../core/fill/types';
import type { ExtractedJobPage } from '../page/jobExtractor';
import type { KeyValueStore } from './adapters';

export const STORAGE_KEYS = {
  profile: 'applypilot.profile',
  jobs: 'applypilot.jobs',
  settings: 'applypilot.settings',
  fillLogs: 'applypilot.fillLogs',
  pendingJob: 'applypilot.pendingJob',
} as const;

export const MAX_SAVED_JOBS = 300;
export const MAX_FILL_LOGS = 30;
export const EXPORT_FORMAT = 'applypilot-export';

export interface Settings {
  weights: DimensionWeights;
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  profile: Profile | null;
  jobs: SavedJob[];
  settings: Settings;
}

/** Acesso aos dados locais do ApplyPilot. Única porta de entrada para persistência. */
export class Repository {
  constructor(private readonly store: KeyValueStore) {}

  async loadProfile(): Promise<Profile | null> {
    const raw = await this.store.get<unknown>(STORAGE_KEYS.profile);
    if (raw === undefined) return null;
    return coerceProfile(raw);
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.store.set(STORAGE_KEYS.profile, { ...profile, updatedAt: new Date().toISOString() });
  }

  async listJobs(): Promise<SavedJob[]> {
    const jobs = (await this.store.get<SavedJob[]>(STORAGE_KEYS.jobs)) ?? [];
    return Array.isArray(jobs) ? jobs.filter((j) => j && typeof j.id === 'string').sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  }

  async getJob(id: string): Promise<SavedJob | undefined> {
    return (await this.listJobs()).find((j) => j.id === id);
  }

  async saveJob(job: SavedJob): Promise<void> {
    const jobs = await this.listJobs();
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) jobs[idx] = job;
    else {
      if (jobs.length >= MAX_SAVED_JOBS) throw new Error(`Limite de ${MAX_SAVED_JOBS} vagas salvas atingido. Exclua vagas antigas.`);
      jobs.unshift(job);
    }
    await this.store.set(STORAGE_KEYS.jobs, jobs);
  }

  async updateJob(id: string, patch: Partial<Pick<SavedJob, 'status' | 'notes' | 'report' | 'parsed'>>): Promise<SavedJob | undefined> {
    const job = await this.getJob(id);
    if (!job) return undefined;
    const updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await this.saveJob(updated);
    return updated;
  }

  async deleteJob(id: string): Promise<void> {
    await this.store.set(STORAGE_KEYS.jobs, (await this.listJobs()).filter((j) => j.id !== id));
  }

  async getSettings(): Promise<Settings> {
    const s = await this.store.get<Partial<Settings>>(STORAGE_KEYS.settings);
    const weights = s?.weights && validateWeights(s.weights).length === 0 ? s.weights : DEFAULT_DIMENSION_WEIGHTS;
    return { weights: { ...weights } };
  }

  async saveSettings(settings: Settings): Promise<void> {
    const errors = validateWeights(settings.weights);
    if (errors.length) throw new Error(errors.join(' '));
    await this.store.set(STORAGE_KEYS.settings, settings);
  }

  async addFillLog(log: FillLog): Promise<void> {
    const logs = await this.listFillLogs();
    await this.store.set(STORAGE_KEYS.fillLogs, [log, ...logs].slice(0, MAX_FILL_LOGS));
  }

  async listFillLogs(): Promise<FillLog[]> {
    return (await this.store.get<FillLog[]>(STORAGE_KEYS.fillLogs)) ?? [];
  }

  /** Vaga capturada de uma página pelo popup, aguardando a tela de análise (uso único). */
  async savePendingJob(job: ExtractedJobPage): Promise<void> {
    await this.store.set(STORAGE_KEYS.pendingJob, { ...job, capturedAt: new Date().toISOString() });
  }

  async takePendingJob(): Promise<(ExtractedJobPage & { capturedAt: string }) | null> {
    const job = await this.store.get<ExtractedJobPage & { capturedAt: string }>(STORAGE_KEYS.pendingJob);
    if (!job) return null;
    await this.store.remove(STORAGE_KEYS.pendingJob);
    // Captura antiga (ex.: aba fechada antes de abrir a análise) é descartada.
    return Date.now() - Date.parse(job.capturedAt) < 10 * 60 * 1000 ? job : null;
  }

  async exportAll(): Promise<ExportBundle> {
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: await this.loadProfile(),
      jobs: await this.listJobs(),
      settings: await this.getSettings(),
    };
  }

  /**
   * Lê um perfil de um JSON exportado (pacote completo ou só o perfil).
   * O conteúdo é tratado como não confiável: passa por coerção estrutural campo a campo.
   */
  parseProfileImport(json: string): Profile {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('Arquivo JSON inválido.');
    }
    const candidate = typeof data === 'object' && data !== null && (data as { format?: unknown }).format === EXPORT_FORMAT ? (data as ExportBundle).profile : data;
    if (!candidate) throw new Error('O arquivo não contém um perfil.');
    return coerceProfile(candidate);
  }

  async clearAll(): Promise<void> {
    for (const key of Object.values(STORAGE_KEYS)) await this.store.remove(key);
  }

  async bytesInUse(): Promise<number | null> {
    return this.store.bytesInUse ? this.store.bytesInUse() : null;
  }
}
