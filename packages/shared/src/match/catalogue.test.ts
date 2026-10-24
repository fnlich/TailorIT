import { describe, expect, it } from 'vitest';
import { CERTIFICATIONS, canonicalCertification, certificationKey, domainOf, findCertifications, findDomains } from './catalogue';
import { prepareEvidence } from './evidence';
import { INDUSTRIES } from '../jobs/taxonomy';

describe('findCertifications', () => {
  it('reads spelled-out names and unambiguous codes, by canonical name, in text order', () => {
    expect(findCertifications('AWS Certified Solutions Architect – Associate (2023); CKA, CKAD')).toEqual([
      'AWS Certified Solutions Architect',
      'Certified Kubernetes Administrator (CKA)',
      'Certified Kubernetes Application Developer (CKAD)',
    ]);
    expect(findCertifications('Certified Kubernetes Administrator')).toEqual(['Certified Kubernetes Administrator (CKA)']);
    expect(findCertifications('HashiCorp Certified: Terraform Associate; AZ-104 and AZ-900')).toEqual([
      'HashiCorp Certified: Terraform Associate',
      'Azure Administrator Associate (AZ-104)',
      'Azure Fundamentals (AZ-900)',
    ]);
    expect(findCertifications('CompTIA Security+ and Network+')).toEqual(['CompTIA Security+', 'CompTIA Network+']);
  });

  it('reads acronyms as written ("cpa" in prose is not one)', () => {
    expect(findCertifications('CPA and CFA')).toEqual(['CPA', 'CFA']);
    expect(findCertifications('the cpa and cfa exams')).toEqual([]);
    expect(findCertifications('CKAD')).toEqual(['Certified Kubernetes Application Developer (CKAD)']);
  });

  it('reads ambiguous acronyms (CSM, CISA, PHR) only with certification context', () => {
    expect(findCertifications('Partner with our CSM team to drive adoption')).toEqual([]);
    expect(findCertifications('CSM certification preferred')).toEqual(['Certified ScrumMaster (CSM)']);
    expect(findCertifications('Scrum: CSM or PSM I')).toEqual(['Certified ScrumMaster (CSM)', 'Professional Scrum Master (PSM)']);
    expect(findCertifications('Coordinate with CISA on incident reporting')).toEqual([]);
    expect(findCertifications('CISSP, CISM or CISA required')).toEqual(['CISSP', 'CISM', 'CISA']);
    expect(findCertifications('Certified Information Systems Auditor')).toEqual(['CISA']);
    expect(findCertifications('Certifications\nCSM\nPMP\nCISA\n\nExperience\nCISA audit liaison')).toEqual([
      'Certified ScrumMaster (CSM)',
      'PMP',
      'CISA',
    ]);
    // Another certification on the line is context too.
    expect(findCertifications('PHR or SHRM-CP')).toEqual(['PHR', 'SHRM-CP']);
    expect(findCertifications('Talk to the PHR team')).toEqual([]);
  });

  it('needs a belt or certification context for Six Sigma, and counts a span once', () => {
    expect(findCertifications('Lean Six Sigma Green Belt')).toEqual(['Six Sigma Green Belt']);
    expect(findCertifications('Experience with Six Sigma methodology')).toEqual([]);
    expect(findCertifications('Six Sigma certified')).toEqual(['Six Sigma']);
    expect(findCertifications('a seasoned Project Management Professional')).toEqual([]);
    expect(findCertifications('Project Management Professional (PMP) certification')).toEqual(['PMP']);
  });

  it('takes the context as given for a certification entry', () => {
    expect(canonicalCertification('CSM')).toBe('Certified ScrumMaster (CSM)');
    expect(canonicalCertification('AWS Solutions Architect - Professional')).toBe('AWS Certified Solutions Architect');
    expect(canonicalCertification('Food Handler Card')).toBeNull();
  });

  it('reads prepared evidence and caps the list', () => {
    expect(findCertifications(prepareEvidence('CKA and CISSP'))).toEqual(['Certified Kubernetes Administrator (CKA)', 'CISSP']);
    expect(findCertifications('CKA, CKAD, CKS', { max: 2 })).toHaveLength(2);
    expect(findCertifications('')).toEqual([]);
  });

  it('has unique canonical names and keys', () => {
    const names = CERTIFICATIONS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names.map(certificationKey)).size).toBe(names.length);
    expect(certificationKey('CompTIA Security+')).toBe('comptiasecurity+');
  });
});

describe('findDomains', () => {
  it('maps unambiguous phrases to INDUSTRIES ids, in text order', () => {
    expect(findDomains('Built clinical data pipelines for a fintech')).toEqual(['healthcare', 'finance']);
    expect(findDomains('logistics and supply chain software')).toEqual(['logistics_transportation']);
    expect(findDomains('Served in the U.S. Army')).toEqual(['military']);
    expect(findDomains('Healthcare Data Analyst')).toEqual(['healthcare']);
  });

  it('reads "defense" only with an industry around it', () => {
    expect(findDomains('Defense in depth; cyber defense; defensive programming')).toEqual([]);
    expect(findDomains('Aerospace and defense customers')).toEqual(['military']);
    expect(findDomains('Department of Defense programs')).toEqual(['military']);
    expect(findDomains('a defense contractor')).toEqual(['military']);
  });

  it('skips equal-opportunity and benefits lines, and words that are technical too', () => {
    expect(findDomains('We consider applicants without regard to military status or protected veteran status.')).toEqual([]);
    expect(findDomains('Medical, dental and vision insurance')).toEqual([]);
    expect(findDomains('Benefits include a transportation stipend')).toEqual([]);
    expect(findDomains('IT asset management tools; video streaming; shipping code; marketplace; utilities')).toEqual([]);
    expect(findDomains('An asset management firm')).toEqual(['finance']);
  });

  it('never names technology, other or not specified', () => {
    const ids = new Set<string>(INDUSTRIES.map((industry) => industry.id));
    const found = findDomains('fintech insurtech healthcare government K-12 retail logistics manufacturing telecom real estate hotel nonprofit gaming law firm oil and gas consulting firm');
    expect(found.length).toBe(5);
    expect(findDomains('fintech insurtech healthcare government K-12 retail', 10).every((id) => ids.has(id))).toBe(true);
    expect(findDomains('a SaaS technology company')).toEqual([]);
  });
});

describe('domainOf', () => {
  it('maps industry names and phrases, never the generic ones', () => {
    expect(domainOf('FinTech')).toBe('finance');
    expect(domainOf('Aerospace & Defense')).toBe('military');
    expect(domainOf('Retail & E-commerce')).toBe('retail_ecommerce');
    expect(domainOf('Technology')).toBeNull();
    expect(domainOf('Software')).toBeNull();
    expect(domainOf('Other')).toBeNull();
    expect(domainOf('')).toBeNull();
  });
});
