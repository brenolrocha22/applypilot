import type { SkillCategory } from '../model/profile';
import { foldPreserving, normalizeText, termRegex } from './normalize';

/**
 * Dicionário local de competências.
 * - `aliases`: formas normalizadas (minúsculas, sem acento) usadas na detecção.
 * - `implies`: conhecer X comprova Y (ex.: PostgreSQL ⇒ SQL). Gera "Atendido" com justificativa.
 * - `related`: X é semelhante a Y, mas não equivalente. Gera no máximo "Parcialmente atendido".
 *
 * Aliases ambíguos (ex.: "go", "r", "c") foram omitidos de propósito para evitar falsos positivos.
 */
export interface SkillDefinition {
  id: string;
  name: string;
  category: SkillCategory;
  aliases: string[];
  implies?: string[];
  related?: string[];
}

const d = (
  id: string,
  name: string,
  category: SkillCategory,
  aliases: string[],
  extra: Pick<SkillDefinition, 'implies' | 'related'> = {},
): SkillDefinition => ({ id, name, category, aliases: [normalizeText(name), ...aliases], ...extra });

export const SKILLS: SkillDefinition[] = [
  // Linguagens
  d('javascript', 'JavaScript', 'technical', ['js', 'ecmascript', 'es6'], { related: ['typescript'] }),
  d('typescript', 'TypeScript', 'technical', [], { implies: ['javascript'] }),
  d('python', 'Python', 'technical', ['python3']),
  d('java', 'Java', 'technical', ['java 8', 'java 11', 'java 17'], { related: ['kotlin'] }),
  d('kotlin', 'Kotlin', 'technical', [], { related: ['java'] }),
  d('csharp', 'C#', 'technical', ['c sharp', 'csharp'], { related: ['dotnet'] }),
  d('cpp', 'C++', 'technical', ['cpp']),
  d('golang', 'Go', 'technical', ['golang', 'go lang', 'linguagem go']),
  d('rust', 'Rust', 'technical', []),
  d('php', 'PHP', 'technical', []),
  d('ruby', 'Ruby', 'technical', []),
  d('scala', 'Scala', 'technical', []),
  d('swift', 'Swift', 'technical', [], { related: ['ios'] }),
  d('sql', 'SQL', 'technical', ['linguagem sql', 't-sql', 'pl/sql', 'plsql']),
  d('html', 'HTML', 'technical', ['html5']),
  d('css', 'CSS', 'technical', ['css3']),
  // Frameworks / bibliotecas
  d('react', 'React', 'technical', ['react.js', 'reactjs'], { implies: ['javascript'], related: ['vue', 'angular', 'react-native'] }),
  d('react-native', 'React Native', 'technical', ['react-native'], { implies: ['javascript'], related: ['react', 'flutter'] }),
  d('nextjs', 'Next.js', 'technical', ['nextjs', 'next js'], { implies: ['react', 'javascript'] }),
  d('vue', 'Vue.js', 'technical', ['vue', 'vuejs', 'vue js'], { implies: ['javascript'], related: ['react', 'angular'] }),
  d('angular', 'Angular', 'technical', ['angularjs', 'angular.js'], { implies: ['typescript'], related: ['react', 'vue'] }),
  d('svelte', 'Svelte', 'technical', [], { related: ['react', 'vue'] }),
  d('nodejs', 'Node.js', 'technical', ['node', 'nodejs', 'node js'], { implies: ['javascript'] }),
  d('express', 'Express.js', 'technical', ['expressjs', 'express js'], { implies: ['nodejs'] }),
  d('nestjs', 'NestJS', 'technical', ['nest.js', 'nest js'], { implies: ['nodejs', 'typescript'] }),
  d('django', 'Django', 'technical', [], { implies: ['python'], related: ['flask', 'fastapi'] }),
  d('flask', 'Flask', 'technical', [], { implies: ['python'], related: ['django', 'fastapi'] }),
  d('fastapi', 'FastAPI', 'technical', [], { implies: ['python'], related: ['django', 'flask'] }),
  d('spring', 'Spring Boot', 'technical', ['spring', 'springboot', 'spring framework'], { implies: ['java'] }),
  d('dotnet', '.NET', 'technical', ['dotnet', 'asp.net', '.net core', 'dot net'], { related: ['csharp'] }),
  d('laravel', 'Laravel', 'technical', [], { implies: ['php'] }),
  d('rails', 'Ruby on Rails', 'technical', ['rails', 'ror'], { implies: ['ruby'] }),
  d('flutter', 'Flutter', 'technical', ['dart'], { related: ['react-native'] }),
  d('android', 'Android', 'technical', [], { related: ['kotlin'] }),
  d('ios', 'iOS', 'technical', [], { related: ['swift'] }),
  d('tailwind', 'Tailwind CSS', 'technical', ['tailwind', 'tailwindcss'], { implies: ['css'] }),
  d('sass', 'Sass', 'technical', ['scss'], { implies: ['css'] }),
  d('pandas', 'Pandas', 'technical', [], { implies: ['python'] }),
  d('numpy', 'NumPy', 'technical', [], { implies: ['python'] }),
  d('spark', 'Apache Spark', 'technical', ['spark', 'pyspark'], { related: ['databricks'] }),
  d('ml', 'Machine Learning', 'technical', ['aprendizado de maquina', 'ml'], { related: ['data-science'] }),
  d('data-science', 'Ciência de Dados', 'domain', ['ciencia de dados', 'data science'], { related: ['ml'] }),
  d('tensorflow', 'TensorFlow', 'technical', [], { implies: ['ml'], related: ['pytorch'] }),
  d('pytorch', 'PyTorch', 'technical', [], { implies: ['ml'], related: ['tensorflow'] }),
  d('llm', 'LLMs / IA Generativa', 'technical', ['llm', 'llms', 'ia generativa', 'generative ai', 'genai'], { related: ['ml'] }),
  // Dados / bancos
  d('postgresql', 'PostgreSQL', 'technical', ['postgres', 'postgre'], { implies: ['sql'], related: ['mysql', 'sqlserver', 'oracle-db'] }),
  d('mysql', 'MySQL', 'technical', ['mariadb'], { implies: ['sql'], related: ['postgresql', 'sqlserver'] }),
  d('sqlserver', 'SQL Server', 'technical', ['mssql', 'microsoft sql server'], { implies: ['sql'], related: ['postgresql', 'mysql'] }),
  d('oracle-db', 'Oracle Database', 'technical', ['oracle db', 'banco oracle', 'oracle database'], { implies: ['sql'], related: ['postgresql'] }),
  d('mongodb', 'MongoDB', 'technical', ['mongo'], { related: ['nosql'] }),
  d('nosql', 'NoSQL', 'technical', [], {}),
  d('redis', 'Redis', 'technical', []),
  d('elasticsearch', 'Elasticsearch', 'technical', ['elastic search', 'opensearch']),
  d('kafka', 'Apache Kafka', 'technical', ['kafka'], { related: ['rabbitmq'] }),
  d('rabbitmq', 'RabbitMQ', 'technical', [], { related: ['kafka'] }),
  d('airflow', 'Apache Airflow', 'tool', ['airflow']),
  d('dbt', 'dbt', 'tool', []),
  d('snowflake', 'Snowflake', 'tool', []),
  d('databricks', 'Databricks', 'tool', [], { related: ['spark'] }),
  d('etl', 'ETL', 'technical', ['elt', 'pipelines de dados', 'data pipelines']),
  d('powerbi', 'Power BI', 'tool', ['powerbi'], { related: ['tableau'] }),
  d('tableau', 'Tableau', 'tool', [], { related: ['powerbi'] }),
  d('excel', 'Excel', 'tool', ['microsoft excel', 'excel avancado']),
  // Cloud / DevOps
  d('aws', 'AWS', 'technical', ['amazon web services'], { related: ['azure', 'gcp'] }),
  d('azure', 'Microsoft Azure', 'technical', ['azure'], { related: ['aws', 'gcp'] }),
  d('gcp', 'Google Cloud', 'technical', ['gcp', 'google cloud platform'], { related: ['aws', 'azure'] }),
  d('docker', 'Docker', 'tool', ['containers', 'conteineres'], { related: ['kubernetes'] }),
  d('kubernetes', 'Kubernetes', 'tool', ['k8s'], { related: ['docker'] }),
  d('terraform', 'Terraform', 'tool', [], { related: ['iac'] }),
  d('iac', 'Infraestrutura como Código', 'methodology', ['infraestrutura como codigo', 'infrastructure as code', 'iac']),
  d('cicd', 'CI/CD', 'methodology', ['ci/cd', 'ci cd', 'integracao continua', 'continuous integration', 'entrega continua']),
  d('github-actions', 'GitHub Actions', 'tool', [], { implies: ['cicd'] }),
  d('jenkins', 'Jenkins', 'tool', [], { implies: ['cicd'] }),
  d('git', 'Git', 'tool', ['github', 'gitlab', 'bitbucket']),
  d('linux', 'Linux', 'technical', ['unix', 'bash', 'shell script']),
  // Arquitetura / práticas
  d('rest', 'APIs REST', 'technical', ['rest', 'restful', 'api rest', 'apis rest', 'rest api', 'rest apis']),
  d('graphql', 'GraphQL', 'technical', [], { related: ['rest'] }),
  d('microservices', 'Microsserviços', 'methodology', ['microsservicos', 'microservicos', 'microservices']),
  d('tdd', 'TDD', 'methodology', ['test driven development', 'desenvolvimento orientado a testes'], { implies: ['automated-testing'] }),
  d('automated-testing', 'Testes automatizados', 'methodology', ['testes automatizados', 'automated tests', 'automated testing', 'testes unitarios', 'unit tests', 'unit testing']),
  d('jest', 'Jest', 'tool', [], { implies: ['automated-testing'], related: ['vitest'] }),
  d('vitest', 'Vitest', 'tool', [], { implies: ['automated-testing'], related: ['jest'] }),
  d('cypress', 'Cypress', 'tool', [], { implies: ['automated-testing'], related: ['playwright', 'selenium'] }),
  d('playwright', 'Playwright', 'tool', [], { implies: ['automated-testing'], related: ['cypress', 'selenium'] }),
  d('selenium', 'Selenium', 'tool', [], { implies: ['automated-testing'], related: ['cypress', 'playwright'] }),
  d('scrum', 'Scrum', 'methodology', [], { implies: ['agile'], related: ['kanban'] }),
  d('kanban', 'Kanban', 'methodology', [], { implies: ['agile'], related: ['scrum'] }),
  d('agile', 'Metodologias ágeis', 'methodology', ['metodologias ageis', 'metodologia agil', 'agile', 'agil']),
  // Ferramentas de negócio / design / produto
  d('jira', 'Jira', 'tool', []),
  d('figma', 'Figma', 'tool', []),
  d('ux', 'UX Design', 'domain', ['ux', 'ux design', 'experiencia do usuario', 'user experience'], { related: ['ui'] }),
  d('ui', 'UI Design', 'domain', ['ui design', 'interface do usuario'], { related: ['ux'] }),
  d('sap', 'SAP', 'tool', []),
  d('salesforce', 'Salesforce', 'tool', []),
  d('google-analytics', 'Google Analytics', 'tool', ['ga4']),
  d('seo', 'SEO', 'domain', []),
  d('digital-marketing', 'Marketing digital', 'domain', ['marketing digital', 'digital marketing']),
  d('project-management', 'Gestão de projetos', 'methodology', ['gestao de projetos', 'gerenciamento de projetos', 'project management', 'pmbok']),
  d('product-management', 'Gestão de produto', 'methodology', ['gestao de produto', 'product management', 'product owner']),
  d('lgpd', 'LGPD', 'domain', ['lei geral de protecao de dados', 'gdpr'], {}),
  // Comportamentais declaradas (avaliadas na dimensão de experiência)
  d('leadership', 'Liderança de equipes', 'behavioral', ['lideranca', 'lideranca de equipes', 'gestao de pessoas', 'leadership', 'people management']),
  d('communication', 'Comunicação', 'behavioral', ['comunicacao', 'communication skills', 'boa comunicacao']),
  d('negotiation', 'Negociação', 'behavioral', ['negociacao', 'negotiation']),
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

export function getSkill(id: string): SkillDefinition | undefined {
  return BY_ID.get(id);
}

/** Resolve um nome livre (ex.: do perfil) para o id canônico, se existir. */
export function resolveSkillId(name: string): string | undefined {
  const n = normalizeText(name);
  for (const s of SKILLS) {
    if (s.aliases.includes(n)) return s.id;
  }
  return undefined;
}

export interface SkillMention {
  skillId: string;
  /** Offsets no texto recebido (normalização preserva posições). */
  start: number;
  end: number;
  alias: string;
}

/**
 * Encontra competências do dicionário (e vocabulário extra) num texto.
 * Usa casamento do alias mais longo primeiro e mascara o trecho, para que
 * "React Native" não gere também "React".
 */
export function findSkillMentions(text: string, extraVocabulary: SkillDefinition[] = []): SkillMention[] {
  const masked = foldPreserving(text).split('');
  const entries: { skillId: string; alias: string }[] = [];
  for (const s of [...SKILLS, ...extraVocabulary]) {
    for (const a of s.aliases) entries.push({ skillId: s.id, alias: a });
  }
  entries.sort((x, y) => y.alias.length - x.alias.length);

  const found: SkillMention[] = [];
  const seen = new Set<string>();
  for (const { skillId, alias } of entries) {
    if (!alias) continue;
    const re = termRegex(alias, 'g');
    const current = masked.join('');
    let m: RegExpExecArray | null;
    while ((m = re.exec(current)) !== null) {
      const start = m.index + (m[1]?.length ?? 0);
      const end = start + alias.length;
      for (let i = start; i < end; i++) masked[i] = '\u0000';
      if (!seen.has(skillId)) {
        seen.add(skillId);
        found.push({ skillId, start, end, alias });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Cria definições ad hoc para competências do perfil que não existem no dicionário. */
export function vocabularyFromNames(names: string[]): SkillDefinition[] {
  const out: SkillDefinition[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const n = normalizeText(name);
    if (n.length < 2 || resolveSkillId(name) || seen.has(n)) continue;
    seen.add(n);
    out.push({ id: `custom:${n}`, name: name.trim(), category: 'technical', aliases: [n] });
  }
  return out;
}

export function skillDisplayName(id: string, fallback?: string): string {
  return BY_ID.get(id)?.name ?? fallback ?? id.replace(/^custom:/, '');
}
