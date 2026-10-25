import { HARD_SKILL_CATEGORIES, type HardSkillCategory } from '@tailorit/shared/resume';

// The hard-skill library as the render gate reads it: the shipped list (skills.json, ~1,500 spellings each under one of
// the 17 headings; an alias is handed in as a record of its own, under its entry's heading) with each user's own
// skills laid over it. Grouped files a resume's skills under the library's heading for each, in the library's heading
// order; Plain prints the library-known skills only. Nothing here reads files: the API hands the records in.

export interface SkillRecord {
  /** The library's spelling. */
  skill: string;
  category: string;
  /** 1 (most specific) to 5; only orders records that share a name. */
  priority?: number | null;
}

export interface SkillIndex {
  get(skill: string): Readonly<SkillRecord> | undefined;
  readonly size: number;
}

/** How skills are matched: trimmed, lower-cased, inner whitespace collapsed. */
export function skillIndexKey(skill: string): string {
  return skill.trim().toLowerCase().replace(/\s+/g, ' ');
}

const CATEGORY_BY_KEY = new Map<string, HardSkillCategory>(
  HARD_SKILL_CATEGORIES.map((category) => [category.toLowerCase(), category]),
);

/** One of the 17 library headings, in its own spelling, or null. */
export function libraryCategory(value: unknown): HardSkillCategory | null {
  return typeof value === 'string' ? (CATEGORY_BY_KEY.get(value.trim().toLowerCase()) ?? null) : null;
}

/**
 * An index over skill records. Records with an unknown heading get one inferred; where two share a name, the more
 * specific (lower priority number) wins, then the first by name.
 */
export function createSkillIndex(records: Iterable<SkillRecord>): SkillIndex {
  const prepared: Array<SkillRecord & { order: number }> = [];
  const seen = new Set<string>();
  let order = 0;
  for (const record of records) {
    const skill = typeof record?.skill === 'string' ? record.skill.trim() : '';
    if (!skill) continue;
    const exact = skill.toLowerCase();
    if (seen.has(exact)) continue;
    seen.add(exact);
    const priority = typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : 5;
    prepared.push({
      skill,
      category: libraryCategory(record.category) ?? inferSkillCategory(skill),
      priority: Math.max(1, Math.min(5, Math.trunc(priority))),
      order: order++,
    });
  }
  prepared.sort(
    (a, b) =>
      (a.priority ?? 5) - (b.priority ?? 5) ||
      a.skill.localeCompare(b.skill, undefined, { sensitivity: 'base' }) ||
      a.order - b.order,
  );
  const index = new Map<string, Readonly<SkillRecord>>();
  for (const { order: _order, ...record } of prepared) {
    const key = skillIndexKey(record.skill);
    if (key && !index.has(key)) index.set(key, Object.freeze(record));
  }
  return { get: (skill) => index.get(skillIndexKey(skill)), size: index.size };
}

/** The library with `extra` laid over it: a name the library already has keeps the library's record. */
export function withExtraSkills(base: SkillIndex, extra: Iterable<SkillRecord>): SkillIndex {
  const own = createSkillIndex(extra);
  if (own.size === 0) return base;
  return {
    get: (skill) => base.get(skill) ?? own.get(skill),
    get size() {
      return base.size + own.size;
    },
  };
}

// ---------------------------------------------------------------------------------------- heading inference

/**
 * Terms per heading, tried in this order; a skill matches a term it equals or contains. The order matters: a more
 * specific heading (AI/ML, Testing, Security...) is tried before a broader one, and Frameworks and Libraries is the
 * answer when nothing matches. Used for a skill a person adds that the library lacks.
 */
const INFERENCE_RULES: ReadonlyArray<readonly [HardSkillCategory, string]> = [
  ['AI/ML & Data Science', 'ai/ml|machine learning|deep learning|mlops|llm|nlp|natural language|computer vision|rag|prompt engineering|fine-tuning|openai|chatgpt|claude|tensorflow|pytorch|keras|scikit|xgboost|lightgbm|spacy|nltk|pandas|numpy|jupyter|langchain|llamaindex|hugging face|transformers|embedding|vector|pinecone|chroma|weaviate|model training|feature engineering'],
  ['Testing and Quality', 'jest|pytest|cypress|playwright|selenium|mocha|chai|junit|testng|vitest|unittest|minitest|testing|test automation|unit test|integration test|e2e|quality|qa|sonarqube|coverage|load test|performance test'],
  ['Security', 'security|secure|auth|oauth|oidc|saml|jwt|encryption|waf|iam|kms|secrets|vulnerability|penetration|sast|dast|rbac|abac|access control|xss|csrf|threat'],
  ['Observability and Monitoring', 'observability|monitoring|logging|metrics|tracing|dashboard|grafana|kibana|prometheus|datadog|new relic|cloudwatch|cloudtrail|splunk|elk|opentelemetry|pagerduty|sentry|x-ray'],
  ['Data Engineering & Streaming', 'kafka|kinesis|pub/sub|rabbitmq|stream|eventbridge|event hubs|sqs|sns|airflow|dbt|etl|data pipeline|data lake|data warehouse|athena|glue|data factory|synapse|snowflake|bigquery|spark|flink|hadoop'],
  ['Databases and Storage', 'postgres|mysql|sql server|sqlite|oracle|mongo|dynamodb|cassandra|couchdb|redis|memcached|firestore|elasticsearch|solr|influxdb|timescale|neo4j|database|nosql|shard|replication|schema|orm|sqlalchemy|prisma|typeorm|sequelize|mongoose|activerecord|storage|s3|aurora|elasticache|presto|query'],
  ['Version Control & Collaboration', 'git|github|gitlab|bitbucket|pull request|code review|version control|jira|confluence'],
  ['DevOps and CI/CD', 'ci/cd|cicd|deployment|pipeline|github actions|gitlab ci|jenkins|circleci|travis|argocd|flux|terraform|cloudformation|pulumi|ansible|puppet|chef|iac|devops|gitops|docker|kubernetes|helm|openshift'],
  ['APIs and Integration', 'api|rest|graphql|grpc|websocket|webhook|openapi|swagger|integration|message queue|service bus|json|xml'],
  ['Mobile Development', 'ios|android|react native|swiftui|flutter|mobile|kotlin multiplatform|xamarin|app store|google play|testflight'],
  ['Frontend & UI/UX Development', 'react|vue|angular|next.js|nuxt|svelte|frontend|front-end|ui|ux|css grid|tailwind|sass|scss|bootstrap|material ui|chakra|figma|responsive|accessibility|storybook'],
  ['Cloud and Infrastructure', 'aws|azure|gcp|google cloud|cloud|ec2|ecs|eks|fargate|rds|cloudfront|lambda|vpc|route 53|load balanc|autoscaling|serverless|netlify|vercel|heroku'],
  ['Operating Systems & Platforms', 'linux|unix|windows|macos|nginx|apache|operating system|file system|network|bash scripting'],
  ['Software Architecture & Design', 'architecture|microservice|distributed|event-driven|domain-driven|ddd|cqrs|saga|solid|design pattern|hexagonal|monorepo|multi-tenant|scalability|caching'],
  ['Engineering Practices & Methodology', 'agile|scrum|kanban|tdd|bdd|pair programming|documentation|requirements|root cause|incident|on-call|sprint|retrospective'],
];

/** Programming languages by exact name (a contains-match would file "Go" under every heading with a "go" in it). */
const LANGUAGE_NAMES = new Set(
  (
    'abap actionscript ada bash c c# c++ clojure cobol css dart elixir erlang f# fortran go golang groovy haskell ' +
    'html java javascript julia kotlin lua matlab objective-c ocaml perl php pl/sql powershell python r ruby rust ' +
    'scala shell solidity sql swift t-sql typescript vb.net zig'
  ).split(' '),
);

/** A short term ("ui", "rds", "e2e") must stand as a word; a longer one may sit inside a name ("postgresql"). */
function termMatcher(term: string): (name: string) => boolean {
  if (term.length > 3) return (name) => name.includes(term);
  const word = new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`);
  return (name) => word.test(name);
}

const TERMS = INFERENCE_RULES.map(([category, terms]) => [category, terms.split('|').map(termMatcher)] as const);

/** The library heading a skill the library lacks most likely belongs under. */
export function inferSkillCategory(skill: string): HardSkillCategory {
  const name = skillIndexKey(skill);
  if (!name) return 'Frameworks and Libraries';
  if (LANGUAGE_NAMES.has(name)) return 'Languages';
  for (const [category, matchers] of TERMS) {
    if (matchers.some((matches) => matches(name))) return category;
  }
  return 'Frameworks and Libraries';
}

// ------------------------------------------------------------------------ the render gate's fallback heading

/**
 * Terms by heading for the render gate's fallback: the heading a resume's own (author-grouped) skill gets when the
 * author did not place it and the library does not know it. A skill matches a term it equals, starts with (then a
 * space, "-" or "/"), ends with (after a space) or holds between spaces. Tried in this order; else Frameworks and
 * Libraries. This is the template contract's rule, so its terms are kept as they are.
 */
const FALLBACK_RULES: ReadonlyArray<readonly [HardSkillCategory, string]> = [
  [
    'Databases and Storage',
    'activerecord|cassandra|couchdb|database|databases|data lake|dynamodb|elasticsearch|etl|firestore|influxdb|' +
      'memcached|mongo|mongodb|mongoose|mysql|neo4j|nosql|oracle|orm|postgres|postgresql|prisma|psql|query|rdbms|' +
      'rdbms/sql|redis|replication|schema|sequelize|shard|snowflake|solr|sql server|sqlalchemy|timescaledb|typeorm|' +
      'warehouse',
  ],
  [
    'Cloud and Infrastructure',
    'amazon web services|ansible|api gateway|argocd|autoscaling|auto scaling|aws|azure|chef|cloud|cloudfront|' +
      'cloudwatch|datadog|deployment|docker|ec2|ecs|eks|elk|fargate|flux|gcp|google cloud|grafana|helm|iac|iam|' +
      'infrastructure|istio|jenkins|k8s|kube|kubernetes|lambda|linkerd|linux|load balanc|netlify|network|new relic|' +
      'nginx|openshift|prometheus|puppet|route 53|s3|terraform|unix/linux|vpc|vercel',
  ],
  [
    'Frameworks and Libraries',
    'react|react.js|reactjs|next|next.js|nextjs|node|node.js|nodejs|vue|vue.js|vuejs|express|express.js|expressjs|' +
      'angular|angular.js|angularjs|nest|nestjs|nest.js|nuxt|nuxt.js|nuxtjs|django|flask|fastapi|fastify|laravel|' +
      'rails|spring|spring boot|springboot|tensorflow|pytorch|torch|keras|scikit-learn|sklearn|pandas|numpy|redux|' +
      'react router|tailwind|tailwindcss|mui|material ui|sass|scss|svelte|svelte.js|sveltejs|ember|ember.js|emberjs|' +
      'jquery|jquery.js|jqueryjs|bootstrap|graphql|swr|flutter|react native|reactnative|.net|dotnet|asp.net|aspnet|' +
      'babel|chakra ui|cypress|emotion|gatsby|junit|langchain|llamaindex|playwright|prettier|pytest|selenium|' +
      'styled-components|testng|css modules|asp.net core|codeigniter|django rest framework|echo|gin|grpc|koa|ktor|' +
      'spring framework|spring mvc|spring security|swiftui',
  ],
  [
    'Languages',
    'python|javascript|typescript|java|go|golang|rust|ruby|php|c++|c#|kotlin|swift|scala|sql|html|css|elixir|bash|' +
      'dart|perl|r|r language|matlab|lua|groovy|shell|powershell|objective-c|html5|css3',
  ],
  [
    'APIs and Integration',
    'docker|kubernetes|k8s|kube|aws|gcp|azure|git|nginx|redis|celery|postgres|postgresql|psql|mongo|mongodb|mysql|' +
      'nosql|openapi|restful api|rest api|rest|jwt|oauth|jest|mocha|chai|ci/cd|github actions|gitlab ci|vercel|' +
      'netlify|figma|sketch|unix/linux|linux|rdbms/sql|rdbms|webpack|vite|gatsby|eslint|openai api|llm|terraform|' +
      'ansible|jenkins|kafka|rabbitmq|airflow|dbt|snowflake|dynamodb|api|ci|github|gitlab|jira|tdd',
  ],
];

const FALLBACK_TERMS = FALLBACK_RULES.map(([category, terms]) => [category, terms.split('|')] as const);

function matchesTerm(name: string, term: string): boolean {
  return (
    name === term ||
    name.startsWith(`${term} `) ||
    name.startsWith(`${term}-`) ||
    name.startsWith(`${term}/`) ||
    name.endsWith(` ${term}`) ||
    name.includes(` ${term} `)
  );
}

/** The heading the render gate files a skill under: the library's, else the fallback rules'. */
export function renderSkillCategory(skill: string, library: SkillIndex): string {
  const name = skillIndexKey(skill);
  if (!name) return 'Frameworks and Libraries';
  const known = library.get(skill);
  if (known) return known.category;
  for (const [category, terms] of FALLBACK_TERMS) {
    if (terms.some((term) => matchesTerm(name, term))) return category;
  }
  return 'Frameworks and Libraries';
}
