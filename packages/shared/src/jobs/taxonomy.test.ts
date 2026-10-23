import { describe, expect, it } from 'vitest';
import {
  FT_JOB_FIELD_MAP,
  INDUSTRIES,
  JOB_CATEGORIES,
  JOB_CATEGORY_IDS,
  JOB_SUBCATEGORY_IDS,
  categoryFact,
  companySizeBucket,
  industryLabel,
  isJobSubcategoryId,
  jobCategoryLabel,
  normalizeIndustry,
  placeFtJobField,
  subcategoryParent,
} from './taxonomy';

// free_tailor's 103 job field ids (backend/src/config/jobFields.ts), re-typed here so the map is checked against them.
const FT_FIELD_IDS = [
  'frontend', 'backend', 'full-stack', 'mobile', 'desktop-apps', 'game-development', 'embedded-firmware',
  'systems-programming', 'cloud-native-serverless', 'ar-vr-xr', 'robotics-autonomous-systems', 'blockchain-web3',
  'scientific-hpc', 'quantum-software', 'low-code-automation', 'enterprise-platforms', 'browser-engines-webassembly',
  'data-engineering', 'database-engineering', 'analytics-engineering-bi', 'data-science', 'ml-engineering',
  'mlops-llmops', 'ai-llm-applications', 'ml-specialties', 'ai-safety-responsible-ai', 'data-governance-privacy',
  'devops', 'site-reliability-engineering', 'platform-engineering', 'cloud-engineering', 'infrastructure-as-code',
  'containers-orchestration', 'observability', 'build-release-engineering', 'networking-cdn-edge',
  'systems-administration-it-ops', 'finops', 'developer-experience', 'manual-testing-qa', 'test-automation-sdet',
  'performance-load-testing', 'accessibility-testing', 'chaos-resilience-engineering',
  'static-analysis-formal-verification', 'safety-reliability-regulated', 'application-security', 'devsecops',
  'penetration-testing', 'threat-modeling-security-architecture', 'cryptography-engineering',
  'identity-access-management', 'cloud-container-security', 'software-supply-chain-security', 'vulnerability-research',
  'incident-response-forensics', 'privacy-engineering-compliance', 'software-architecture', 'api-design',
  'distributed-systems', 'microservices-event-driven', 'concurrency-performance', 'design-patterns-refactoring',
  'legacy-modernization', 'version-control-code-review', 'technical-debt-management', 'engineering-metrics',
  'open-source', 'ui-ux-design', 'design-systems', 'accessibility', 'product-management', 'business-analysis',
  'technical-writing', 'developer-relations', 'localization-internationalization', 'solutions-sales-support-engineering',
  'methodologies', 'project-program-management', 'engineering-management', 'estimation-planning-roadmapping',
  'it-service-management', 'software-licensing-ip-regulation', 'software-business', 'mentoring-hiring-education',
  'fintech-trading', 'healthcare-it', 'automotive', 'aerospace-defense', 'telecom', 'ecommerce-edtech-govtech-legaltech',
  'geospatial-gis', 'energy-smart-grid', 'digital-twins-simulation', 'bioinformatics', 'media-tech', 'green-software',
  'ai-assisted-agentic-development', 'agent-platforms-tool-protocols', 'edge-ai-on-device-ml',
  'confidential-computing-pets', 'post-quantum-cryptography-migration', 'webgpu-wasm-runtimes',
];

describe('taxonomy', () => {
  it('has the 18 parent categories with unique ids', () => {
    expect(JOB_CATEGORIES).toHaveLength(18);
    expect(new Set(JOB_CATEGORY_IDS).size).toBe(18);
    expect(jobCategoryLabel('devops-infrastructure')).toBe('DevOps & Infrastructure');
    expect(JOB_CATEGORIES.at(-1)?.label).toBe('Other');
  });

  it('keeps subcategory ids unique across the whole taxonomy', () => {
    expect(new Set(JOB_SUBCATEGORY_IDS).size).toBe(JOB_SUBCATEGORY_IDS.length);
    expect(subcategoryParent('site-reliability-engineering')).toBe('devops-infrastructure');
  });

  it('maps every one of free_tailor\'s 103 job fields to a real category and subcategory', () => {
    expect(FT_FIELD_IDS).toHaveLength(103);
    expect(Object.keys(FT_JOB_FIELD_MAP).sort()).toEqual([...FT_FIELD_IDS].sort());
    for (const id of FT_FIELD_IDS) {
      const placement = FT_JOB_FIELD_MAP[id]!;
      expect(isJobSubcategoryId(placement.subcategoryId), id).toBe(true);
      expect(subcategoryParent(placement.subcategoryId), id).toBe(placement.categoryId);
    }
  });

  it('places SRE under DevOps & Infrastructure, and nothing for unclassified', () => {
    expect(placeFtJobField('site-reliability-engineering')).toEqual({
      categoryId: 'devops-infrastructure',
      subcategoryId: 'site-reliability-engineering',
    });
    expect(placeFtJobField(' Frontend ')).toEqual({ categoryId: 'software-engineering', subcategoryId: 'frontend' });
    expect(placeFtJobField('unclassified')).toBeNull();
    expect(placeFtJobField(42)).toBeNull();
  });

  it('prints the facts-grid category line', () => {
    expect(categoryFact('devops-infrastructure', ['site-reliability-engineering', 'frontend'])).toEqual({
      label: 'DevOps & Infrastructure',
      detail: 'Site Reliability Engineering',
    });
    expect(categoryFact(null)).toBeNull();
  });
});

describe('industries and company sizes', () => {
  it('carries free_tailor\'s industries with other last', () => {
    expect(INDUSTRIES).toHaveLength(19);
    expect(INDUSTRIES.at(-1)?.id).toBe('other');
    expect(industryLabel('retail_ecommerce')).toBe('Retail & E-commerce');
    expect(industryLabel('not_specified')).toBe('Not specified');
  });

  it.each([
    ['FinTech', 'finance'],
    ['Retail & E-commerce', 'retail_ecommerce'],
    ['retail and e commerce', 'retail_ecommerce'],
    ['Technology', 'technology'],
    ['SaaS', 'technology'],
    ['unknown', 'not_specified'],
    ['Basket weaving', null],
  ])('normalizes industry %s', (text, expected) => {
    expect(normalizeIndustry(text)).toBe(expected);
  });

  it('buckets head counts', () => {
    expect(companySizeBucket(8)).toBe('1-10');
    expect(companySizeBucket(1000)).toBe('501-1000');
    expect(companySizeBucket(250_000)).toBe('10001+');
    expect(companySizeBucket(0)).toBeNull();
  });
});
