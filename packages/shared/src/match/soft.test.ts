import { describe, expect, it } from 'vitest';
import { prepareEvidence } from './evidence';
import {
  EVERYDAY_SOFT_SKILLS,
  canonicalSoftSkill,
  compileSoftSkills,
  findSoftSkills,
  isHardSoftOverlap,
  softKey,
  softSkillScanner,
} from './soft';

// Entries as they are in skills.json (the API passes the whole list).
const SOFT = [
  'Accountability', 'Adaptability', 'Analytical', 'Analytical root-cause analysis', 'Attention to detail', 'Balancing',
  'Calm change management', 'Change Management', 'Collaboration', 'Communication', 'Communication skills',
  'Conflict resolution', 'Cross-functional Collaboration', 'Customer Success', 'Data-informed decision making',
  'Decision Making', 'Delegation', 'Diligence', 'Effective communication', 'ES6', 'Excellent work ethic', 'Forecasting',
  'Integrity', 'Interpersonal Skills', 'Leadership', 'Mediation', 'Mentoring', 'Multitasking', 'Negotiation',
  'Non-technical communication', 'Organization', 'Ownership', 'Persistence', 'Planning', 'Presentation',
  'Presentation skills', 'Problem Solving', 'Problem-solving', 'Reliability', 'Root Cause Analysis', 'Scheduling',
  'Sponsorship', 'Stakeholder Management', 'Strong analytical skills', 'Strong communication skills',
  'Strong problem-solving skills', 'Technical communication', 'Teamwork', 'Time management', 'Work Ethic',
  'Written Communication',
];
const HARD = [
  'Change Management', 'Process Improvement', 'Root Cause Analysis', 'JavaScript', 'Sprint Planning', 'Load Balancing',
  'Merge Conflict Resolution', 'Site Reliability Engineering', 'Python', 'Go', 'Kubernetes',
];
const scanner = compileSoftSkills(SOFT, HARD);
const soft = (text: string) => findSoftSkills(text, scanner);

describe('softKey', () => {
  it('ignores case, hyphens, slashes and spacing', () => {
    expect(softKey('  Problem-Solving ')).toBe('problem solving');
    expect(softKey('Problem Solving')).toBe(softKey('problem-solving'));
    expect(softKey('Zoom In / Zoom Out')).toBe('zoom in zoom out');
  });
});

describe('canonical names', () => {
  it('reduce an entry to the longest shorter entry it ends with, split on spaces', () => {
    expect(canonicalSoftSkill('Strong communication skills', scanner)).toBe('Communication');
    expect(canonicalSoftSkill('communication skills', scanner)).toBe('Communication');
    expect(canonicalSoftSkill('Data-informed decision making', scanner)).toBe('Decision Making');
    expect(canonicalSoftSkill('Excellent work ethic', scanner)).toBe('Work Ethic');
    expect(canonicalSoftSkill('Strong analytical skills', scanner)).toBe('Analytical');
    expect(canonicalSoftSkill('Strong problem-solving skills', scanner)).toBe('Problem Solving');
    expect(canonicalSoftSkill('Presentation skills', scanner)).toBe('Presentation');
  });

  it('never reach past a negation', () => {
    expect(canonicalSoftSkill('Non-technical communication', scanner)).toBe('Non-technical communication');
    expect(canonicalSoftSkill('Interpersonal Skills', scanner)).toBe('Interpersonal Skills');
  });

  it('are null for a term the list does not have', () => {
    expect(canonicalSoftSkill('Juggling', scanner)).toBeNull();
  });
});

describe('findSoftSkills', () => {
  it('reads in any case and reports canonical names, first mention first', () => {
    expect(soft('EXCELLENT communication skills and strong COLLABORATION.')).toEqual(['Communication', 'Collaboration']);
    expect(soft('Mentoring juniors; cross-functional collaboration; time management')).toEqual([
      'Mentoring',
      'Collaboration',
      'Time management',
    ]);
  });

  it('reads hyphens and spaces between words alike', () => {
    expect(soft('data-informed decision-making')).toEqual(['Decision Making']);
    expect(soft('problem solving and problem-solving')).toEqual(['Problem Solving']);
  });

  it('never reads a skill across a negation', () => {
    expect(soft('non-technical communication with partners')).toEqual(['Non-technical communication']);
    expect(soft('non technical communication')).toEqual(['Non-technical communication']);
    // A list without the negated entry: "technical communication" after "non-" is not that skill.
    const withoutEntry = compileSoftSkills(['Technical communication', 'Teamwork']);
    expect(findSoftSkills('Non-technical communication', withoutEntry)).toEqual([]);
    expect(findSoftSkills('non technical communication; teamwork', withoutEntry)).toEqual(['Teamwork']);
    expect(findSoftSkills('Technical communication', withoutEntry)).toEqual(['Technical communication']);
  });

  it('does not read technical phrases as soft skills', () => {
    expect(soft('Microservices talk over inter-service communication (gRPC).')).toEqual([]);
    expect(soft('service-to-service communication; serial communication; network communications')).toEqual([]);
    expect(soft('Clear communication with product partners')).toEqual(['Communication']);
  });

  it('keeps hard/soft overlaps hard', () => {
    expect(soft('Led change management and root cause analysis; calm change management')).toEqual([]);
    expect(soft('Analytical root-cause analysis')).toEqual([]);
    expect(soft('ES6 and stakeholder management')).toEqual(['Stakeholder Management']);
    expect(isHardSoftOverlap('Calm change management', scanner)).toBe(true);
    expect(isHardSoftOverlap('ES6', scanner)).toBe(true);
    expect(isHardSoftOverlap('Communication', scanner)).toBe(false);
  });

  it("lets the person's own lists win: a skill filed as hard is not reported as soft", () => {
    expect(findSoftSkills('Leadership and mentoring', scanner, { exclude: ['Leadership'] })).toEqual(['Mentoring']);
    expect(findSoftSkills('strong communication skills', scanner, { exclude: ['communication'] })).toEqual([]);
  });

  it('counts everyday words only as whole list items', () => {
    expect(soft('Skills: Planning, Ownership, Delegation')).toEqual(['Planning', 'Ownership', 'Delegation']);
    expect(soft('Soft skills: Negotiation and Mediation')).toEqual(['Negotiation', 'Mediation']);
    expect(soft('- Negotiation\n• Multitasking')).toEqual(['Negotiation', 'Multitasking']);
    expect(soft('Planning\nOwnership')).toEqual(['Planning', 'Ownership']);
    expect(soft('Integrity | Reliability | Teamwork')).toEqual(['Integrity', 'Reliability', 'Teamwork']);
    expect(soft('We offer visa sponsorship. Load balancing, site reliability and data persistence.')).toEqual([]);
    expect(soft('Due diligence on vendors; content negotiation in HTTP; OS multitasking; DNS delegation')).toEqual([]);
    expect(soft('Responsible for capacity planning, scheduling, forecasting')).toEqual([]);
    expect(soft('We value integrity, ownership and passion in our organization.')).toEqual([]);
    expect(soft('Customer Success Manager at Acme')).toEqual([]);
    expect(soft('Skills: Customer Success, Teamwork')).toEqual(['Customer Success', 'Teamwork']);
  });

  it('does not take a heading for a list item', () => {
    expect(soft('PLANNING')).toEqual([]);
    expect(soft('Planning:')).toEqual([]);
  });

  it('lets a hard phrase shadow the soft words in it', () => {
    expect(soft('Sprint Planning, Scheduling')).toEqual(['Scheduling']);
    expect(soft('Merge conflict resolution in git')).toEqual([]);
    expect(soft('Conflict resolution with peers')).toEqual(['Conflict resolution']);
  });

  it('caps the list and reads prepared evidence', () => {
    expect(findSoftSkills('Teamwork, Leadership, Mentoring', scanner, { max: 2 })).toEqual(['Teamwork', 'Leadership']);
    expect(findSoftSkills(prepareEvidence('Strong teamwork'), scanner)).toEqual(['Teamwork']);
    expect(findSoftSkills('', scanner)).toEqual([]);
  });

  it('compiles a pair of lists once', () => {
    expect(softSkillScanner(SOFT, HARD)).toBe(softSkillScanner(SOFT, HARD));
  });

  it('lists the everyday words the plan names', () => {
    const keys = new Set(EVERYDAY_SOFT_SKILLS.map(softKey));
    for (const word of ['Persistence', 'Delegation', 'Diligence', 'Negotiation', 'Multitasking', 'Mediation', 'Planning']) {
      expect(keys.has(softKey(word))).toBe(true);
    }
  });
});
