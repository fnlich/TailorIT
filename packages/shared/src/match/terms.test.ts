import { describe, expect, it } from 'vitest';
import {
  alnumRuns,
  containsTerm,
  countTerm,
  maskFalseFriends,
  matchKey,
  synonymKey,
  synonymsOf,
  TERM_SYNONYMS,
  termPattern,
} from './terms';

describe('containsTerm boundaries', () => {
  it.each([
    ['Experience with C++ and Java', 'C++', true],
    ['Modern C++17 codebase', 'C++', true],
    ['Built services in C#.', 'C#', true],
    ['Node.js developer', 'Node.js', true],
    ['node.js developer', 'Node.js', true],
    ['Owns our CI/CD pipelines', 'CI/CD', true],
    ['Shipped ASP.NET Core apps', '.NET', false],
    ['See acme.net for details', '.NET', false],
    ['Javaé', 'Java', false],
    ['éJava', 'Java', false],
    ['Kotlin, Java', 'java', true],
    ['.NET 8 services', '.NET', true],
    ['We write Go every day', 'Go', true],
    ['We are going places', 'Go', false],
    ['go to the store', 'Go', false],
    ['Golang and Go', 'Go', true],
    ['JavaScript, TypeScript', 'Java', false],
    ['PostgreSQL tuning', 'SQL', false],
    ['T-SQL stored procedures', 'SQL', true],
    ['Experience with C++ only', 'C', false],
    ['C# only', 'C', false],
    ['C/C++ firmware', 'C', true],
    ['machine   learning models', 'Machine Learning', true],
    ['Machine\nLearning', 'machine learning', true],
    ['ML platform', 'ML', true],
    ['html emails', 'ml', false],
    ['Kubernetes', '   ', false],
  ])('%s / %s -> %s', (text, term, expected) => {
    expect(containsTerm(text, term)).toBe(expected);
  });

  it('finds CI as its own term inside CI/CD (punctuation is a boundary)', () => {
    // The extractor resolves the overlap (longest term wins); the matcher reads the pattern as written.
    expect(containsTerm('CI/CD pipelines', 'CI')).toBe(true);
    expect(containsTerm('CICD pipelines', 'CI')).toBe(false);
  });

  it('is case-sensitive for terms of two characters or fewer only', () => {
    expect(termPattern('Go')?.flags).toBe('u');
    expect(termPattern('Rust')?.flags).toBe('iu');
    expect(termPattern('Rust', { caseSensitive: true })?.flags).toBe('u');
    expect(termPattern('Rust', true)?.flags).toBe('giu');
  });

  it('counts occurrences and the first index', () => {
    expect(countTerm('Go, Go and more Go', 'Go')).toEqual({ count: 3, first: 0 });
    expect(countTerm('nothing here', 'Go')).toEqual({ count: 0, first: -1 });
  });
});

describe('false friends', () => {
  it('masks clearances and companies so they do not match technologies', () => {
    expect(containsTerm(maskFalseFriends('Active TS/SCI clearance required'), 'TS')).toBe(false);
    expect(containsTerm(maskFalseFriends('Worked at American Express'), 'Express')).toBe(false);
    expect(containsTerm(maskFalseFriends('Own the go-to-market plan'), 'Go')).toBe(false);
    expect(maskFalseFriends('TS/SCI').length).toBe('TS/SCI'.length);
  });
});

describe('synonyms', () => {
  it('folds spellings of one thing to one key', () => {
    expect(synonymKey('K8s')).toBe(synonymKey('Kubernetes'));
    expect(synonymKey('JS')).toBe(synonymKey('JavaScript'));
    expect(synonymKey('js')).toBe(synonymKey('JavaScript'));
    expect(synonymKey('Postgres')).toBe(synonymKey('PostgreSQL'));
    expect(synonymKey('Google Cloud Platform')).toBe(synonymKey('GCP'));
    expect(synonymKey('Amazon Web Services')).toBe(synonymKey('AWS'));
    expect(synonymKey('ML')).toBe(synonymKey('machine learning'));
    expect(synonymKey('Golang')).toBe(synonymKey('Go'));
  });

  it('lists no spelling in two groups (the later group would silently take it)', () => {
    const groupOf = new Map<string, number>();
    TERM_SYNONYMS.forEach((group, index) => {
      expect(group.length, `group ${index} has spellings to fold`).toBeGreaterThan(1);
      for (const spelling of group) {
        expect(groupOf.get(matchKey(spelling)), `"${spelling}" is in groups ${groupOf.get(matchKey(spelling))} and ${index}`).toBeUndefined();
        groupOf.set(matchKey(spelling), index);
      }
    });
  });

  it("folds the skill library's aliases (apps/api/static/skills/skills.json) to their entries", () => {
    for (const [spelling, entry] of [
      ['Argo CD', 'ArgoCD'],
      ['Auto-scaling', 'Auto Scaling'],
      ['SolidJS', 'Solid.js'],
      ['API Gateways', 'API gateway'],
      ['AWS S3', 'Amazon S3'],
      ['S3', 'AWS S3'],
      ['AWS DynamoDB', 'DynamoDB'],
      ['SQS', 'Amazon SQS'],
      ['SNS', 'Amazon SNS'],
      ['CloudFormation', 'AWS CloudFormation'],
      ['AWS ECS', 'Amazon ECS'],
      ['ECS', 'AWS ECS'],
      ['RDS', 'Amazon RDS'],
      ['Route53', 'Amazon Route 53'],
      ['Avro', 'Apache Avro'],
      ['Flink', 'Apache Flink'],
    ] as const) {
      expect(synonymKey(spelling), `${spelling} and ${entry}`).toBe(synonymKey(entry));
    }
  });

  it('leaves apart short names that are an everyday word or another product', () => {
    expect(synonymKey('Lambda')).not.toBe(synonymKey('AWS Lambda'));
    expect(synonymKey('Beam')).not.toBe(synonymKey('Apache Beam'));
    expect(synonymKey('VPC')).not.toBe(synonymKey('Amazon VPC'));
    expect(synonymKey('IAM')).not.toBe(synonymKey('AWS IAM'));
    expect(synonymKey('CDK')).not.toBe(synonymKey('AWS CDK'));
  });

  it('keeps unrelated terms apart and case-folds long ones', () => {
    expect(synonymKey('Java')).not.toBe(synonymKey('JavaScript'));
    expect(synonymKey('  Terraform ')).toBe('terraform');
    expect(synonymKey('QQ')).not.toBe(synonymKey('qq'));
  });

  it('lists a group canonical first', () => {
    expect(synonymsOf('k8s')).toEqual(['Kubernetes', 'K8s', 'k8s']);
    expect(synonymsOf('Terraform')).toEqual(['Terraform']);
  });

  it('lists alphanumeric runs', () => {
    expect([...alnumRuns('C++ and Node.js')]).toEqual(['c', 'and', 'node', 'js']);
  });
});
