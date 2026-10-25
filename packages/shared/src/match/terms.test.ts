import { describe, expect, it } from 'vitest';
import {
  alnumRuns,
  containsTerm,
  countTerm,
  maskFalseFriends,
  matchKey,
  mergeSynonymGroups,
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
      ['Lambda', 'AWS Lambda'],
      ['Beam', 'Apache Beam'],
      ['VPC', 'Amazon VPC'],
      ['IAM', 'AWS IAM'],
      ['CDK', 'AWS CDK'],
      ['WAF', 'AWS WAF'],
      ['Aurora', 'Amazon Aurora'],
      ['Express', 'Express.js'],
      ['REST API', 'REST'],
      ['GraphQL API', 'GraphQL'],
      ['Android SDK', 'Android'],
      ['OpenTelemetry SDK', 'OpenTelemetry'],
    ] as const) {
      expect(synonymKey(spelling), `${spelling} and ${entry}`).toBe(synonymKey(entry));
    }
  });

  it("folds a family into its main skill: versions, modules and companions (the skill library's aliases)", () => {
    for (const [member, main] of [
      ['ASP.NET Core', '.NET'],
      ['.NET Core', '.NET'],
      ['Spring Security', 'Spring Boot'],
      ['Spring', 'Spring Boot'],
      ['Redux', 'React'],
      ['React Router', 'React'],
      ['Django REST Framework', 'Django'],
      ['HTTP/2', 'HTTP'],
      ['Ubuntu', 'Linux'],
      ['Load Testing', 'Performance Testing'],
      ['Singleton Pattern', 'Design Patterns'],
      ['Microservices architecture', 'Microservices'],
    ] as const) {
      expect(synonymKey(member), `${member} and ${main}`).toBe(synonymKey(main));
    }
  });

  it("keeps apart different products, a generic name and a vendor's product that is not it, and everyday words", () => {
    expect(synonymKey('SQL')).not.toBe(synonymKey('Azure SQL'));
    expect(synonymKey('DevOps')).not.toBe(synonymKey('Azure DevOps'));
    expect(synonymKey('IAM')).not.toBe(synonymKey('Google IAM'));
    expect(synonymKey('MySQL')).not.toBe(synonymKey('PostgreSQL'));
    expect(synonymKey('Jest')).not.toBe(synonymKey('Mocha'));
    expect(synonymKey('Docker')).not.toBe(synonymKey('Kubernetes'));
    expect(synonymKey('AWS Lambda')).not.toBe(synonymKey('Amazon S3'));
    // Words of ordinary prose: in a group, "any kind of" on a resume would read as Kubernetes.
    expect(synonymKey('Kind')).not.toBe(synonymKey('Kubernetes'));
    expect(synonymKey('Ingress')).not.toBe(synonymKey('Kubernetes'));
    expect(synonymKey('Triggers')).not.toBe(synonymKey('SQL'));
    expect(synonymKey('Promises')).not.toBe(synonymKey('Async Programming'));
    expect(synonymKey('Paging')).not.toBe(synonymKey('Pagination'));
  });

  it("merges groups that share a spelling, the earliest group's first spelling staying canonical", () => {
    expect(mergeSynonymGroups([['Kubernetes', 'kubectl'], ['Go'], ['Kubernetes', 'K8s'], ['JS', 'JavaScript'], ['K8s', 'k8s cluster']])).toEqual([
      ['Kubernetes', 'kubectl', 'K8s', 'k8s cluster'],
      ['JS', 'JavaScript'],
    ]);
    // A later group joining two earlier ones folds them into the first.
    expect(mergeSynonymGroups([['A1', 'B1'], ['C1', 'D1'], ['B1', 'C1']])).toEqual([['A1', 'B1', 'C1', 'D1']]);
  });

  it('keeps unrelated terms apart and case-folds long ones', () => {
    expect(synonymKey('Java')).not.toBe(synonymKey('JavaScript'));
    expect(synonymKey('  Terraform ')).toBe('terraform');
    expect(synonymKey('QQ')).not.toBe(synonymKey('qq'));
  });

  it('lists a group canonical first', () => {
    expect(synonymsOf('k8s')[0]).toBe('Kubernetes');
    expect(synonymsOf('k8s')).toEqual(expect.arrayContaining(['K8s', 'kubectl', 'k8s']));
    expect(synonymsOf('Ansible')).toEqual(['Ansible']);
  });

  it('lists alphanumeric runs', () => {
    expect([...alnumRuns('C++ and Node.js')]).toEqual(['c', 'and', 'node', 'js']);
  });
});
