import type { Experience, YearMonth } from '../model/profile';

const YM_RE = /^(\d{4})(?:-(\d{2}))?$/;

export function isValidYearMonth(v: string): boolean {
  const m = YM_RE.exec(v);
  if (!m) return false;
  const month = m[2] ? Number(m[2]) : 1;
  return Number(m[1]) >= 1900 && Number(m[1]) <= 2100 && month >= 1 && month <= 12;
}

/** Converte "YYYY-MM" (ou "YYYY") em índice absoluto de mês. */
export function monthIndex(v: YearMonth): number | null {
  const m = YM_RE.exec(v);
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

export function toYearMonth(date: Date): YearMonth {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface ExperienceInterval {
  experienceId: string;
  start: number;
  end: number;
}

/** Intervalo em meses de uma experiência; null se as datas forem insuficientes. */
export function experienceInterval(exp: Experience, referenceDate: Date): ExperienceInterval | null {
  if (!exp.startDate) return null;
  const start = monthIndex(exp.startDate);
  const endRaw = exp.current ? toYearMonth(referenceDate) : exp.endDate;
  if (start === null || !endRaw) return null;
  const end = monthIndex(endRaw);
  if (end === null || end < start) return null;
  // +1: jan–jan conta como 1 mês trabalhado.
  return { experienceId: exp.id, start, end: end + 1 };
}

/** Soma meses de intervalos, sem contar períodos sobrepostos duas vezes. */
export function mergedMonths(intervals: ExperienceInterval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const iv of sorted) {
    if (iv.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    } else {
      curEnd = Math.max(curEnd, iv.end);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export interface YearsComputation {
  years: number;
  countedExperienceIds: string[];
  /** Experiências sem datas completas (não contabilizadas). */
  undatedExperienceIds: string[];
}

export function totalYears(experiences: Experience[], referenceDate: Date): YearsComputation {
  const intervals: ExperienceInterval[] = [];
  const undated: string[] = [];
  for (const e of experiences) {
    const iv = experienceInterval(e, referenceDate);
    if (iv) intervals.push(iv);
    else undated.push(e.id);
  }
  return {
    years: Math.round((mergedMonths(intervals) / 12) * 10) / 10,
    countedExperienceIds: intervals.map((i) => i.experienceId),
    undatedExperienceIds: undated,
  };
}
