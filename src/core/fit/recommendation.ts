import { DIMENSION_LABELS, type FitReport, type Recommendation } from '../model/fit';

/**
 * Recomendação explicada, gerada por regras a partir do relatório.
 * Nunca é formulada como chance de contratação.
 */
export function buildRecommendation(r: Omit<FitReport, 'recommendation'>): Recommendation {
  const explanation: string[] = [];
  const nextActions: string[] = [];

  if (r.overallScore === null) {
    return {
      level: 'insufficient_data',
      headline: 'Não há dados suficientes para calcular a compatibilidade.',
      explanation: ['Nenhuma dimensão pôde ser avaliada com as informações do perfil e da vaga.'],
      nextActions: ['Complete seu perfil (experiências, competências, formação e idiomas).', 'Confira se a descrição da vaga foi colada por completo.'],
    };
  }

  const coveragePct = Math.round(r.coverage * 100);
  explanation.push(`Compatibilidade geral: ${r.overallScore}/100, calculada sobre ${coveragePct}% dos pesos (dimensões avaliáveis).`);

  const strong = r.dimensions.filter((d) => d.evaluable && (d.score ?? 0) >= 75).map((d) => DIMENSION_LABELS[d.dimension].toLowerCase());
  const weak = r.dimensions.filter((d) => d.evaluable && (d.score ?? 0) < 50).map((d) => DIMENSION_LABELS[d.dimension].toLowerCase());
  if (strong.length) explanation.push(`Pontos fortes: ${strong.join(', ')}.`);
  if (weak.length) explanation.push(`Pontos de atenção: ${weak.join(', ')}.`);

  const c = r.counts;
  if (c.requiredMetPct !== null) {
    explanation.push(`${c.requiredMet} de ${c.requiredTotal} requisitos obrigatórios estão comprovadamente atendidos (${c.requiredMetPct}%).`);
  } else {
    explanation.push('A vaga não separa explicitamente requisitos obrigatórios; todos foram tratados com importância padrão.');
  }

  const notMet = r.blockers.filter((b) => b.status === 'not_met');
  const pending = r.blockers.filter((b) => b.status !== 'not_met');
  if (notMet.length) explanation.push(`${notMet.length} requisito(s) obrigatório(s) não atendido(s) segundo o seu perfil.`);
  if (pending.length) explanation.push(`${pending.length} requisito(s) obrigatório(s) ainda não comprovado(s) ou atendido(s) parcialmente.`);

  const cultureConflicts = r.dimensions.find((d) => d.dimension === 'culture')?.assessments.filter((a) => a.status === 'not_met') ?? [];
  if (cultureConflicts.length) explanation.push(`Conflito com suas preferências: ${cultureConflicts.map((a) => a.requirement.label).join('; ')}.`);

  // Próximas ações
  for (const b of pending.filter((b) => b.status === 'not_proven').slice(0, 5)) {
    nextActions.push(`Se você atende a "${b.requirement.label}", adicione a evidência ao seu perfil.`);
  }
  if (notMet.length) nextActions.push('Avalie se os requisitos não atendidos são realmente eliminatórios antes de se candidatar.');
  if (r.needsConfirmation.length) nextActions.push(`Confirme ${r.needsConfirmation.length} informação(ões) extraída(s) que sustentam esta análise.`);
  if (r.coverage < 0.6) nextActions.push('Complete as seções do perfil que impediram a avaliação de algumas dimensões.');

  let level: Recommendation['level'];
  let headline: string;
  if (r.blockers.length) {
    level = 'review_blockers';
    headline = notMet.length
      ? 'Há requisito obrigatório não atendido: revise antes de decidir sobre a candidatura.'
      : 'Há requisito obrigatório ainda não comprovado: revise-o antes de decidir sobre a candidatura.';
  } else if (r.overallScore >= 75) {
    level = 'strong';
    headline = 'Boa correspondência com os requisitos identificados.';
    nextActions.push('Revise o relatório e, se fizer sentido, prossiga com a candidatura.');
  } else if (r.overallScore >= 50) {
    level = 'moderate';
    headline = 'Correspondência parcial com os requisitos identificados.';
    nextActions.push('Destaque no currículo as experiências relevantes listadas no relatório.');
  } else {
    level = 'weak';
    headline = 'Baixa correspondência com os requisitos identificados.';
    nextActions.push('Verifique se o perfil está completo antes de concluir que a vaga não é adequada.');
  }
  if (r.coverage < 0.6) explanation.push('Atenção: cobertura baixa; a nota pode mudar quando o perfil estiver mais completo.');

  return { level, headline, explanation, nextActions };
}
