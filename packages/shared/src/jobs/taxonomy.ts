// TailorIT's job taxonomy: 18 parent categories, each with subcategories. Ids are stable (they are stored on jobs and in
// saved searches); labels are display only. Subcategory ids are unique across the whole taxonomy, so a filter can name
// one without its parent. The software and tech subcategories follow free_tailor's 103 job fields
// (backend/src/config/jobFields.ts), regrouped under these parents; `FT_JOB_FIELD_MAP` maps each of those ids here.

export interface JobSubcategory {
  id: string;
  label: string;
}

export interface JobCategory {
  id: string;
  label: string;
  subcategories: readonly JobSubcategory[];
}

const sub = <const I extends string>(id: I, label: string) => ({ id, label });

export const JOB_CATEGORIES = [
  {
    id: 'software-engineering',
    label: 'Software Engineering',
    subcategories: [
      sub('frontend', 'Frontend'),
      sub('backend', 'Backend'),
      sub('full-stack', 'Full-Stack'),
      sub('mobile', 'Mobile'),
      sub('desktop', 'Desktop Applications'),
      sub('game-development', 'Game Development'),
      sub('embedded', 'Embedded & Firmware'),
      sub('systems-programming', 'Systems Programming'),
      sub('cloud-native', 'Cloud-Native & Serverless'),
      sub('ar-vr', 'AR/VR & Spatial Computing'),
      sub('robotics', 'Robotics & Autonomous Systems'),
      sub('blockchain', 'Blockchain & Web3'),
      sub('hpc', 'Scientific & High-Performance Computing'),
      sub('quantum', 'Quantum Computing'),
      sub('low-code', 'Low-Code & Automation'),
      sub('enterprise-platforms', 'Enterprise Platforms'),
      sub('browsers-webassembly', 'Browser Engines & WebAssembly'),
      sub('software-architecture', 'Software Architecture'),
      sub('api-design', 'API Design & Integration'),
      sub('distributed-systems', 'Distributed Systems'),
      sub('performance-engineering', 'Performance Engineering'),
      sub('code-quality', 'Code Quality & Refactoring'),
      sub('legacy-modernization', 'Legacy Modernization'),
      sub('developer-tools', 'Developer Tools & Version Control'),
      sub('open-source', 'Open Source'),
      sub('fintech-trading', 'Fintech & Trading Systems'),
      sub('healthcare-it', 'Healthcare IT'),
      sub('automotive-software', 'Automotive Software'),
      sub('aerospace-defense', 'Aerospace & Defense Software'),
      sub('telecom-software', 'Telecom Software'),
      sub('vertical-saas', 'E-commerce, EdTech, GovTech & LegalTech'),
      sub('geospatial', 'Geospatial & GIS'),
      sub('energy-software', 'Energy & Smart Grid'),
      sub('simulation', 'Simulation & Digital Twins'),
      sub('media-tech', 'Media Tech (Audio & Video)'),
      sub('green-software', 'Green Software'),
    ],
  },
  {
    id: 'data-analytics',
    label: 'Data & Analytics',
    subcategories: [
      sub('data-engineering', 'Data Engineering'),
      sub('database-engineering', 'Database Engineering'),
      sub('analytics-engineering', 'Analytics Engineering & BI'),
      sub('data-science', 'Data Science'),
      sub('data-analysis', 'Data Analysis'),
      sub('data-governance', 'Data Governance & Privacy'),
      sub('bioinformatics', 'Bioinformatics & Computational Biology'),
    ],
  },
  {
    id: 'ai-ml',
    label: 'AI & Machine Learning',
    subcategories: [
      sub('ml-engineering', 'Machine Learning Engineering'),
      sub('mlops', 'MLOps & LLMOps'),
      sub('llm-applications', 'AI & LLM Applications'),
      sub('applied-ml', 'Applied ML (Vision, NLP, Search)'),
      sub('ai-research', 'AI Research'),
      sub('ai-safety', 'AI Safety & Responsible AI'),
      sub('ai-assisted-development', 'AI-Assisted Development'),
      sub('agent-platforms', 'Agent Platforms & Tooling'),
      sub('edge-ai', 'Edge AI & On-Device ML'),
    ],
  },
  {
    id: 'devops-infrastructure',
    label: 'DevOps & Infrastructure',
    subcategories: [
      sub('devops', 'DevOps'),
      sub('site-reliability-engineering', 'Site Reliability Engineering'),
      sub('platform-engineering', 'Platform Engineering'),
      sub('cloud-engineering', 'Cloud Engineering & Architecture'),
      sub('infrastructure-as-code', 'Infrastructure as Code'),
      sub('containers-orchestration', 'Containers & Orchestration'),
      sub('observability', 'Observability'),
      sub('build-release', 'Build & Release Engineering'),
      sub('networking', 'Networking, CDN & Edge'),
      sub('finops', 'FinOps'),
      sub('developer-experience', 'Developer Experience'),
    ],
  },
  {
    id: 'security',
    label: 'Security',
    subcategories: [
      sub('application-security', 'Application Security'),
      sub('devsecops', 'DevSecOps'),
      sub('offensive-security', 'Penetration Testing & Red Teaming'),
      sub('security-architecture', 'Security Architecture & Threat Modeling'),
      sub('cryptography', 'Cryptography'),
      sub('identity-access', 'Identity & Access Management'),
      sub('cloud-security', 'Cloud & Container Security'),
      sub('supply-chain-security', 'Software Supply Chain Security'),
      sub('vulnerability-research', 'Vulnerability Research & Malware Analysis'),
      sub('incident-response', 'Incident Response & Forensics'),
      sub('security-operations', 'Security Operations'),
      sub('privacy-compliance', 'Privacy & Compliance'),
      sub('confidential-computing', 'Confidential Computing'),
    ],
  },
  {
    id: 'qa-testing',
    label: 'QA & Testing',
    subcategories: [
      sub('manual-qa', 'Manual QA'),
      sub('test-automation', 'Test Automation / SDET'),
      sub('performance-testing', 'Performance & Load Testing'),
      sub('accessibility-testing', 'Accessibility Testing'),
      sub('resilience-engineering', 'Chaos & Resilience Engineering'),
      sub('formal-verification', 'Static Analysis & Formal Verification'),
      sub('safety-critical', 'Safety-Critical Systems'),
    ],
  },
  {
    id: 'design',
    label: 'Design',
    subcategories: [
      sub('product-design', 'Product & UX Design'),
      sub('ux-research', 'UX Research'),
      sub('design-systems', 'Design Systems'),
      sub('accessibility', 'Accessibility'),
      sub('visual-design', 'Visual & Brand Design'),
    ],
  },
  {
    id: 'product',
    label: 'Product',
    subcategories: [
      sub('product-management', 'Product Management'),
      sub('technical-product-management', 'Technical Product Management'),
      sub('business-analysis', 'Business Analysis'),
      sub('technical-writing', 'Technical Writing'),
      sub('localization', 'Localization & Internationalization'),
      sub('product-strategy', 'Product Strategy & Planning'),
    ],
  },
  {
    id: 'engineering-management',
    label: 'Engineering Management',
    subcategories: [
      sub('engineering-leadership', 'Engineering Manager & Leadership'),
      sub('program-management', 'Technical Program Management'),
      sub('agile-delivery', 'Agile & Delivery'),
      sub('engineering-metrics', 'Engineering Metrics'),
      sub('mentoring-education', 'Mentoring & Engineering Education'),
    ],
  },
  {
    id: 'it-support',
    label: 'IT & Support',
    subcategories: [
      sub('systems-administration', 'Systems Administration'),
      sub('help-desk', 'Help Desk & Technical Support'),
      sub('it-service-management', 'IT Service Management'),
      sub('network-administration', 'Network Administration'),
    ],
  },
  {
    id: 'sales-solutions',
    label: 'Sales & Solutions',
    subcategories: [
      sub('solutions-engineering', 'Solutions & Sales Engineering'),
      sub('account-executive', 'Account Executive'),
      sub('sales-development', 'Sales Development'),
      sub('business-development', 'Business Development & Partnerships'),
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    subcategories: [
      sub('product-marketing', 'Product Marketing'),
      sub('growth-marketing', 'Growth & Performance Marketing'),
      sub('content-marketing', 'Content Marketing'),
      sub('brand-communications', 'Brand & Communications'),
      sub('seo', 'SEO'),
      sub('developer-relations', 'Developer Relations'),
    ],
  },
  {
    id: 'customer-success',
    label: 'Customer Success',
    subcategories: [
      sub('customer-success-management', 'Customer Success Management'),
      sub('customer-support', 'Customer Support'),
      sub('implementation', 'Implementation & Onboarding'),
      sub('support-engineering', 'Support Engineering'),
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    subcategories: [
      sub('business-operations', 'Business Operations'),
      sub('strategy', 'Strategy'),
      sub('revenue-operations', 'Revenue Operations'),
      sub('supply-chain', 'Supply Chain & Logistics'),
      sub('project-management', 'Project Management'),
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    subcategories: [
      sub('accounting', 'Accounting'),
      sub('financial-planning', 'Financial Planning & Analysis'),
      sub('investment', 'Investment & Banking'),
      sub('audit-tax', 'Audit & Tax'),
    ],
  },
  {
    id: 'people-hr',
    label: 'People & HR',
    subcategories: [
      sub('recruiting', 'Recruiting & Talent'),
      sub('people-operations', 'People Operations'),
      sub('compensation-benefits', 'Compensation & Benefits'),
      sub('learning-development', 'Learning & Development'),
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    subcategories: [
      sub('legal-counsel', 'Legal Counsel'),
      sub('compliance', 'Compliance'),
      sub('ip-licensing', 'IP, Licensing & Regulation'),
      sub('contracts', 'Contracts'),
    ],
  },
  { id: 'other', label: 'Other', subcategories: [] },
] as const satisfies readonly JobCategory[];

export type JobCategoryId = (typeof JOB_CATEGORIES)[number]['id'];
export type JobSubcategoryId = (typeof JOB_CATEGORIES)[number]['subcategories'][number]['id'];

export const OTHER_CATEGORY_ID: JobCategoryId = 'other';

export const JOB_CATEGORY_IDS = JOB_CATEGORIES.map((category) => category.id) as [JobCategoryId, ...JobCategoryId[]];
export const JOB_SUBCATEGORY_IDS = JOB_CATEGORIES.flatMap((category) =>
  category.subcategories.map((entry) => entry.id),
) as [JobSubcategoryId, ...JobSubcategoryId[]];

const CATEGORY_BY_ID = new Map<string, JobCategory>(JOB_CATEGORIES.map((category) => [category.id, category]));
const SUBCATEGORY_BY_ID = new Map<string, JobSubcategory & { categoryId: JobCategoryId }>(
  JOB_CATEGORIES.flatMap((category) =>
    category.subcategories.map((entry) => [entry.id, { ...entry, categoryId: category.id }] as const),
  ),
);

export function isJobCategoryId(value: unknown): value is JobCategoryId {
  return typeof value === 'string' && CATEGORY_BY_ID.has(value);
}

export function isJobSubcategoryId(value: unknown): value is JobSubcategoryId {
  return typeof value === 'string' && SUBCATEGORY_BY_ID.has(value);
}

/** A category's label; '' for an unknown id. */
export function jobCategoryLabel(id: string | null | undefined): string {
  return (id && CATEGORY_BY_ID.get(id)?.label) || '';
}

/** A subcategory's label; '' for an unknown id. */
export function jobSubcategoryLabel(id: string | null | undefined): string {
  return (id && SUBCATEGORY_BY_ID.get(id)?.label) || '';
}

/** The category a subcategory sits under, or null. */
export function subcategoryParent(id: string | null | undefined): JobCategoryId | null {
  return (id && SUBCATEGORY_BY_ID.get(id)?.categoryId) || null;
}

/** The facts grid's category line: "DevOps & Infrastructure", with "Site Reliability Engineering" under it. */
export function categoryFact(
  categoryId: string | null | undefined,
  subcategoryIds: readonly string[] = [],
): { label: string; detail: string } | null {
  const label = jobCategoryLabel(categoryId);
  if (!label) return null;
  const detail = subcategoryIds
    .filter((id) => subcategoryParent(id) === categoryId)
    .map(jobSubcategoryLabel)
    .filter(Boolean)
    .join(', ');
  return { label, detail };
}

type Placement = { categoryId: JobCategoryId; subcategoryId: JobSubcategoryId };
const at = (categoryId: JobCategoryId, subcategoryId: JobSubcategoryId): Placement => ({ categoryId, subcategoryId });
const sw = (id: JobSubcategoryId) => at('software-engineering', id);
const data = (id: JobSubcategoryId) => at('data-analytics', id);
const ai = (id: JobSubcategoryId) => at('ai-ml', id);
const ops = (id: JobSubcategoryId) => at('devops-infrastructure', id);
const sec = (id: JobSubcategoryId) => at('security', id);
const qa = (id: JobSubcategoryId) => at('qa-testing', id);

/**
 * free_tailor job field id -> TailorIT category and subcategory, for the Job Data Lake importer. Covers all 103 fields;
 * `unclassified` (and anything else) has no placement.
 */
export const FT_JOB_FIELD_MAP: Readonly<Record<string, Placement>> = {
  // 1. Building software
  frontend: sw('frontend'),
  backend: sw('backend'),
  'full-stack': sw('full-stack'),
  mobile: sw('mobile'),
  'desktop-apps': sw('desktop'),
  'game-development': sw('game-development'),
  'embedded-firmware': sw('embedded'),
  'systems-programming': sw('systems-programming'),
  'cloud-native-serverless': sw('cloud-native'),
  'ar-vr-xr': sw('ar-vr'),
  'robotics-autonomous-systems': sw('robotics'),
  'blockchain-web3': sw('blockchain'),
  'scientific-hpc': sw('hpc'),
  'quantum-software': sw('quantum'),
  'low-code-automation': sw('low-code'),
  'enterprise-platforms': sw('enterprise-platforms'),
  'browser-engines-webassembly': sw('browsers-webassembly'),
  // 2. Data, AI and machine learning
  'data-engineering': data('data-engineering'),
  'database-engineering': data('database-engineering'),
  'analytics-engineering-bi': data('analytics-engineering'),
  'data-science': data('data-science'),
  'ml-engineering': ai('ml-engineering'),
  'mlops-llmops': ai('mlops'),
  'ai-llm-applications': ai('llm-applications'),
  'ml-specialties': ai('applied-ml'),
  'ai-safety-responsible-ai': ai('ai-safety'),
  'data-governance-privacy': data('data-governance'),
  // 3. Infrastructure and operations
  devops: ops('devops'),
  'site-reliability-engineering': ops('site-reliability-engineering'),
  'platform-engineering': ops('platform-engineering'),
  'cloud-engineering': ops('cloud-engineering'),
  'infrastructure-as-code': ops('infrastructure-as-code'),
  'containers-orchestration': ops('containers-orchestration'),
  observability: ops('observability'),
  'build-release-engineering': ops('build-release'),
  'networking-cdn-edge': ops('networking'),
  'systems-administration-it-ops': at('it-support', 'systems-administration'),
  finops: ops('finops'),
  'developer-experience': ops('developer-experience'),
  // 4. Quality and testing
  'manual-testing-qa': qa('manual-qa'),
  'test-automation-sdet': qa('test-automation'),
  'performance-load-testing': qa('performance-testing'),
  'accessibility-testing': qa('accessibility-testing'),
  'chaos-resilience-engineering': qa('resilience-engineering'),
  'static-analysis-formal-verification': qa('formal-verification'),
  'safety-reliability-regulated': qa('safety-critical'),
  // 5. Security
  'application-security': sec('application-security'),
  devsecops: sec('devsecops'),
  'penetration-testing': sec('offensive-security'),
  'threat-modeling-security-architecture': sec('security-architecture'),
  'cryptography-engineering': sec('cryptography'),
  'identity-access-management': sec('identity-access'),
  'cloud-container-security': sec('cloud-security'),
  'software-supply-chain-security': sec('supply-chain-security'),
  'vulnerability-research': sec('vulnerability-research'),
  'incident-response-forensics': sec('incident-response'),
  'privacy-engineering-compliance': sec('privacy-compliance'),
  // 6. Architecture and engineering practice
  'software-architecture': sw('software-architecture'),
  'api-design': sw('api-design'),
  'distributed-systems': sw('distributed-systems'),
  'microservices-event-driven': sw('distributed-systems'),
  'concurrency-performance': sw('performance-engineering'),
  'design-patterns-refactoring': sw('code-quality'),
  'legacy-modernization': sw('legacy-modernization'),
  'version-control-code-review': sw('developer-tools'),
  'technical-debt-management': sw('code-quality'),
  'engineering-metrics': at('engineering-management', 'engineering-metrics'),
  'open-source': sw('open-source'),
  // 7. Design, product and communication
  'ui-ux-design': at('design', 'product-design'),
  'design-systems': at('design', 'design-systems'),
  accessibility: at('design', 'accessibility'),
  'product-management': at('product', 'product-management'),
  'business-analysis': at('product', 'business-analysis'),
  'technical-writing': at('product', 'technical-writing'),
  'developer-relations': at('marketing', 'developer-relations'),
  'localization-internationalization': at('product', 'localization'),
  'solutions-sales-support-engineering': at('sales-solutions', 'solutions-engineering'),
  // 8. Process, management and business
  methodologies: at('engineering-management', 'agile-delivery'),
  'project-program-management': at('engineering-management', 'program-management'),
  'engineering-management': at('engineering-management', 'engineering-leadership'),
  'estimation-planning-roadmapping': at('product', 'product-strategy'),
  'it-service-management': at('it-support', 'it-service-management'),
  'software-licensing-ip-regulation': at('legal', 'ip-licensing'),
  'software-business': at('product', 'product-strategy'),
  'mentoring-hiring-education': at('engineering-management', 'mentoring-education'),
  // 10. Industry-specific software
  'fintech-trading': sw('fintech-trading'),
  'healthcare-it': sw('healthcare-it'),
  automotive: sw('automotive-software'),
  'aerospace-defense': sw('aerospace-defense'),
  telecom: sw('telecom-software'),
  'ecommerce-edtech-govtech-legaltech': sw('vertical-saas'),
  'geospatial-gis': sw('geospatial'),
  'energy-smart-grid': sw('energy-software'),
  'digital-twins-simulation': sw('simulation'),
  bioinformatics: data('bioinformatics'),
  'media-tech': sw('media-tech'),
  'green-software': sw('green-software'),
  // 11. Emerging areas
  'ai-assisted-agentic-development': ai('ai-assisted-development'),
  'agent-platforms-tool-protocols': ai('agent-platforms'),
  'edge-ai-on-device-ml': ai('edge-ai'),
  'confidential-computing-pets': sec('confidential-computing'),
  'post-quantum-cryptography-migration': sec('cryptography'),
  'webgpu-wasm-runtimes': sw('browsers-webassembly'),
};

/** Where a free_tailor job field files in TailorIT's taxonomy, or null (`unclassified`, unknown ids). */
export function placeFtJobField(fieldId: unknown): Placement | null {
  if (typeof fieldId !== 'string') return null;
  const key = fieldId.trim().toLowerCase();
  return Object.hasOwn(FT_JOB_FIELD_MAP, key) ? FT_JOB_FIELD_MAP[key]! : null;
}

// --------------------------------------------------------------------------------------------- industries

/** free_tailor's industry list (config/industries.ts), `other` last; `not_specified` is stored for "says nothing". */
export const INDUSTRIES = [
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'finance', label: 'Finance' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'military', label: 'Military' },
  { id: 'government', label: 'Government' },
  { id: 'education', label: 'Education' },
  { id: 'retail_ecommerce', label: 'Retail & E-commerce' },
  { id: 'technology', label: 'Technology' },
  { id: 'consulting', label: 'Consulting' },
  { id: 'media_entertainment', label: 'Media & Entertainment' },
  { id: 'logistics_transportation', label: 'Logistics & Transportation' },
  { id: 'energy_utilities', label: 'Energy & Utilities' },
  { id: 'manufacturing', label: 'Manufacturing' },
  { id: 'telecommunications', label: 'Telecommunications' },
  { id: 'legal', label: 'Legal' },
  { id: 'real_estate', label: 'Real Estate' },
  { id: 'hospitality_travel', label: 'Hospitality & Travel' },
  { id: 'nonprofit', label: 'Nonprofit' },
  { id: 'other', label: 'Other' },
] as const;

export const NOT_SPECIFIED_INDUSTRY = 'not_specified';
export type IndustryId = (typeof INDUSTRIES)[number]['id'] | typeof NOT_SPECIFIED_INDUSTRY;
export const INDUSTRY_IDS: [IndustryId, ...IndustryId[]] = [
  INDUSTRIES[0].id,
  ...INDUSTRIES.slice(1).map((entry) => entry.id),
  NOT_SPECIFIED_INDUSTRY,
];

const INDUSTRY_LABEL = new Map<string, string>(INDUSTRIES.map((entry) => [entry.id, entry.label]));

/** An industry's label; "Not specified" for `not_specified`, '' for an unknown id. */
export function industryLabel(id: string | null | undefined): string {
  if (id === NOT_SPECIFIED_INDUSTRY) return 'Not specified';
  return (id && INDUSTRY_LABEL.get(id)) || '';
}

function foldWord(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

const INDUSTRY_ALIASES: Readonly<Record<string, IndustryId>> = {
  fintech: 'finance',
  financial_services: 'finance',
  banking: 'finance',
  insurtech: 'insurance',
  defense: 'military',
  defence: 'military',
  govtech: 'government',
  public_sector: 'government',
  edtech: 'education',
  ecommerce: 'retail_ecommerce',
  e_commerce: 'retail_ecommerce',
  retail: 'retail_ecommerce',
  saas: 'technology',
  tech: 'technology',
  software: 'technology',
  internet: 'technology',
  media: 'media_entertainment',
  entertainment: 'media_entertainment',
  gaming: 'media_entertainment',
  logistics: 'logistics_transportation',
  transportation: 'logistics_transportation',
  energy: 'energy_utilities',
  utilities: 'energy_utilities',
  telecom: 'telecommunications',
  hospitality: 'hospitality_travel',
  travel: 'hospitality_travel',
  non_profit: 'nonprofit',
  not_for_profit: 'nonprofit',
  unspecified: NOT_SPECIFIED_INDUSTRY,
  unknown: NOT_SPECIFIED_INDUSTRY,
  none: NOT_SPECIFIED_INDUSTRY,
};

const INDUSTRY_BY_FOLDED = new Map<string, IndustryId>([
  ...INDUSTRIES.map((entry) => [foldWord(entry.id), entry.id] as const),
  ...INDUSTRIES.map((entry) => [foldWord(entry.label), entry.id] as const),
  [NOT_SPECIFIED_INDUSTRY, NOT_SPECIFIED_INDUSTRY],
]);

/** An industry id from an id, a label or a common alias ("FinTech", "Retail & E-commerce"); null when unknown. */
export function normalizeIndustry(value: unknown): IndustryId | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const folded = foldWord(value);
  return INDUSTRY_BY_FOLDED.get(folded) ?? (Object.hasOwn(INDUSTRY_ALIASES, folded) ? INDUSTRY_ALIASES[folded]! : null);
}

// --------------------------------------------------------------------------------------- other job facets

/** Simplify's company-size buckets. */
export const COMPANY_SIZES = [
  { id: '1-10', label: '1-10' },
  { id: '11-50', label: '11-50' },
  { id: '51-200', label: '51-200' },
  { id: '201-500', label: '201-500' },
  { id: '501-1000', label: '501-1,000' },
  { id: '1001-5000', label: '1,001-5,000' },
  { id: '5001-10000', label: '5,001-10,000' },
  { id: '10001+', label: '10,001+' },
] as const;
export type CompanySizeId = (typeof COMPANY_SIZES)[number]['id'];
export const COMPANY_SIZE_IDS = COMPANY_SIZES.map((entry) => entry.id) as [CompanySizeId, ...CompanySizeId[]];

/** The bucket a head count falls in, or null. */
export function companySizeBucket(employees: number | null | undefined): CompanySizeId | null {
  if (typeof employees !== 'number' || !Number.isFinite(employees) || employees < 1) return null;
  if (employees <= 10) return '1-10';
  if (employees <= 50) return '11-50';
  if (employees <= 200) return '51-200';
  if (employees <= 500) return '201-500';
  if (employees <= 1000) return '501-1000';
  if (employees <= 5000) return '1001-5000';
  if (employees <= 10000) return '5001-10000';
  return '10001+';
}

export const CLEARANCE_FILTERS = ['required', 'not_required'] as const;
export type ClearanceFilter = (typeof CLEARANCE_FILTERS)[number];
export const CLEARANCE_FILTER_LABEL: Record<ClearanceFilter, string> = {
  required: 'Requires security clearance',
  not_required: 'No security clearance required',
};

export const JOB_REPORT_REASONS = ['inactive', 'spam', 'inaccurate', 'duplicate', 'other'] as const;
export type JobReportReason = (typeof JOB_REPORT_REASONS)[number];
export const JOB_REPORT_REASON_LABEL: Record<JobReportReason, string> = {
  inactive: 'The job is no longer open',
  spam: 'Spam or a scam',
  inaccurate: 'The details are wrong',
  duplicate: 'A duplicate posting',
  other: 'Something else',
};
