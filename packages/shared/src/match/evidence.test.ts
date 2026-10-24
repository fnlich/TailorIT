import { describe, expect, it } from 'vitest';
import { evidenceHas, prepareEvidence } from './evidence';
import { matchKeywords, matchPreparedKeywords, planKeywords, spellingsOf } from './keywords';
import type { JobKeywords, MatchedKeyword } from './schemas';
import { containsTerm, maskFalseFriends, synonymKey, termPattern } from './terms';

// The prepared evidence must answer exactly what the full scan answers: the Jobs card, Resume Score and the resume
// picker all score through it.

const TEXTS = [
  'Shipped ASP.NET Core apps and .NET 8 services',
  'See acme.net for details; .net framework; dotnet',
  'Built services in C#. Also C#9, c# scripts and C#.NET',
  'Modern C++17 codebase; C/C++ firmware; C++ only; CPP',
  'We write Go every day; going places; go to the store; Golang and Go.',
  'Owns our CI/CD pipelines; CICD; CI-CD; CI only',
  'Node.js developer; node.js; NodeJS; Node JS; node',
  'Javaé éJava Ångström straße naïve café Go',
  'Holds an active TS/SCI clearance; TypeScript (TS); go-to-market plan; American Express; Express.js',
  '\u212aubernetes on \u212a8s; ma\u017fter of \u017fcala; \u212aotlin and \u017f',
  'Kubernetes\u212a; \u212aKubernetes; Ku\u212aernetes; \u212a',
  'machine   learning models\nMachine\nLearning; ML platform; html emails',
  'PostgreSQL tuning; T-SQL stored procedures; SQL; Postgres',
  '٣Go Go٣ 5Go Go5 G٣o',
  '',
  '\u00a0Go\u00a0and\u2003CI/CD\u3000',
  'F#; R; R&D; A/B testing; a/b; R and Python',
  'K8s, k8s, K8S and JS; js; JavaScript',
  '\u0280eact \ua4d7ubernetes \u041aUBERNETES',
  '- Go\n* Rust\n• Kotlin, Swift',
  // Spaces inside a term's leading punctuation match any run of spaces: the shortcut cannot know the length.
  'Use +   go and #\tNET; - Go; (  Go ); +go',
];

const TERMS = [
  '.NET', 'ASP.NET', '.net', 'dotnet', 'C#', 'C++', 'C', 'CPP', 'Go', 'go', 'Golang', 'CI/CD', 'CI', 'CICD', 'Node.js',
  'NodeJS', 'Node JS', 'node', 'Java', 'JavaScript', 'JS', 'TS', 'TypeScript', 'Express', 'Kubernetes', 'K8s',
  'Kotlin', 'Scala', 'master', 'Ångström', 'straße', 'naïve', 'café', 'machine learning', 'Machine Learning', 'ML',
  'ml', 'SQL', 'T-SQL', 'PostgreSQL', 'Postgres', 'R', 'R&D', 'A/B testing', 'F#', '  Go  ', '', '   ',
  '\u212aubernetes', '\u017fcala', '\u212a', '5Go', 'Go5', '++', '-', 'C#.NET', 'html', 'Rust', 'Swift', '٣Go',
  'React', 'G٣o', 'and', 'Python', 'go-to-market', 'Express.js', '+ go', '# NET', '- Go', '( Go )', '+go',
];

describe('evidenceHas', () => {
  it('answers exactly what containsTerm answers over the masked text', () => {
    for (const text of TEXTS) {
      const prepared = prepareEvidence(text);
      const masked = maskFalseFriends(text);
      for (const term of TERMS) {
        expect(evidenceHas(prepared, term), `${JSON.stringify(text)} / ${JSON.stringify(term)}`).toBe(
          containsTerm(masked, term),
        );
      }
    }
  });

  it('agrees on random texts and terms, KELVIN SIGN and LONG S included', () => {
    const alphabet = [
      'a', 'b', 'c', 'g', 'o', 'k', 's', 'K', 'S', 'G', 'O', 'N', 'E', 'T', '.', '#', '+', '/', '-', ' ', ' ', '\n', 'é',
      '1', '8', '\u212a', '\u017f', '\u00a0', '٣',
    ];
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const word = (max: number) => {
      const length = Math.floor(next() * max);
      let out = '';
      for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(next() * alphabet.length)];
      return out;
    };
    // Terms come from a pool, so each pattern is compiled once (as in use, where terms repeat).
    const pool = Array.from({ length: 300 }, () => word(6));
    let compared = 0;
    const disagreements: string[] = [];
    for (let round = 0; round < 400; round += 1) {
      const text = word(40);
      const prepared = prepareEvidence(text);
      const masked = maskFalseFriends(text);
      for (let pick = 0; pick < 15; pick += 1) {
        const term = pool[Math.floor(next() * pool.length)]!;
        if (evidenceHas(prepared, term) !== containsTerm(masked, term)) {
          disagreements.push(`${JSON.stringify(text)} / ${JSON.stringify(term)}`);
        }
        compared += 1;
      }
    }
    expect(disagreements).toEqual([]);
    expect(compared).toBe(6000);
  });

  it('agrees on terms cut from the text with their case and K/S forms changed', () => {
    const alphabet = ['a', 'b', 'k', 's', 'K', 'S', 'G', 'o', '.', '#', '+', '/', '-', ' ', '\n', 'é', '1', '\u212a', '\u017f', '٣'];
    const swaps: Record<string, readonly string[]> = {
      k: ['K', '\u212a'],
      K: ['k', '\u212a'],
      '\u212a': ['k', 'K'],
      s: ['S', '\u017f'],
      S: ['s', '\u017f'],
      '\u017f': ['s', 'S'],
    };
    let seed = 777;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const mutate = (term: string) =>
      [...term]
        .map((char) => {
          const options = swaps[char];
          if (options && next() < 0.5) return options[Math.floor(next() * options.length)]!;
          if (next() < 0.2) return char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
          return char;
        })
        .join('');
    const disagreements: string[] = [];
    for (let round = 0; round < 300; round += 1) {
      let text = '';
      const length = Math.floor(next() * 40);
      for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(next() * alphabet.length)];
      const prepared = prepareEvidence(text);
      const masked = maskFalseFriends(text);
      for (let pick = 0; pick < 4; pick += 1) {
        const at = Math.floor(next() * Math.max(1, text.length));
        const term = mutate(text.slice(at, at + 1 + Math.floor(next() * 6)));
        if (evidenceHas(prepared, term) !== containsTerm(masked, term)) {
          disagreements.push(`${JSON.stringify(text)} / ${JSON.stringify(term)}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('reads KELVIN SIGN as k and LONG S as s, as a case-insensitive pattern does', () => {
    const prepared = prepareEvidence('\u212aubernetes and \u017fcala');
    expect(evidenceHas(prepared, 'Kubernetes')).toBe(true);
    expect(evidenceHas(prepared, 'Scala')).toBe(true);
    expect(containsTerm('\u212aubernetes', 'Kubernetes')).toBe(true);
    // Terms of two characters are case-sensitive: the sign is not the letter there.
    expect(evidenceHas(prepareEvidence('\u212a8'), 'K8')).toBe(false);
  });

  it('keeps the boundaries of the full scan', () => {
    const prepared = prepareEvidence('Shipped ASP.NET Core apps; .NET 8; C++17; C# only; going places');
    expect(evidenceHas(prepared, '.NET')).toBe(true);
    expect(evidenceHas(prepareEvidence('Shipped ASP.NET Core apps'), '.NET')).toBe(false);
    expect(evidenceHas(prepared, 'C++')).toBe(true);
    expect(evidenceHas(prepared, 'C')).toBe(false);
    expect(evidenceHas(prepared, 'Go')).toBe(false);
    expect(evidenceHas(prepareEvidence('Active TS/SCI clearance'), 'TS')).toBe(false);
  });

  it('prepares a 60,000-character text in a few milliseconds', () => {
    let text = '';
    while (text.length < 60_000) text += 'Led the migration of 40 services to Kubernetes, Go and PostgreSQL on AWS; CI/CD. ';
    text = text.slice(0, 60_000);
    prepareEvidence(text);
    const started = Date.now();
    for (let run = 0; run < 20; run += 1) prepareEvidence(text);
    // About 1 ms each on a laptop; the bound only catches an accidental quadratic.
    expect((Date.now() - started) / 20).toBeLessThan(50);
  });
});

/** matchKeywords as it was before the prepared evidence: the reference the new path must equal. */
function referenceMatch(evidenceText: string, keywords: JobKeywords) {
  const text = maskFalseFriends(evidenceText);
  const seen = new Set<string>();
  const matched: MatchedKeyword[] = [];
  const missing: MatchedKeyword[] = [];
  for (const priority of ['high', 'low'] as const) {
    for (const group of keywords[priority]) {
      const term = group.term.replace(/\s+/g, ' ').trim();
      if (!term) continue;
      const spellings = spellingsOf(group);
      const keys = spellings.map(synonymKey);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      (spellings.some((spelling) => containsTerm(text, spelling)) ? matched : missing).push({ term, priority });
    }
  }
  const total = matched.length + missing.length;
  return { matched, missing, matchedCount: matched.length, total, percentage: total > 0 ? Math.round((matched.length / total) * 100) : 0 };
}

describe('matchPreparedKeywords', () => {
  const keywords: JobKeywords = {
    high: [
      { term: 'Kubernetes', synonyms: [] },
      { term: 'Go', synonyms: ['Golang'] },
      { term: '.NET', synonyms: [] },
      { term: 'C#', synonyms: ['CSharp'] },
      { term: '  ', synonyms: [] },
    ],
    low: [
      { term: 'K8s', synonyms: [] },
      { term: 'Node.js', synonyms: [] },
      { term: 'TS', synonyms: [] },
      { term: 'C++', synonyms: [] },
      { term: 'CI/CD', synonyms: [] },
      { term: 'Express', synonyms: [] },
    ],
  };

  it('equals the full-scan match on every text', () => {
    for (const text of TEXTS) {
      expect(matchKeywords(text, keywords)).toEqual(referenceMatch(text, keywords));
      expect(matchPreparedKeywords(prepareEvidence(text), planKeywords(keywords))).toEqual(referenceMatch(text, keywords));
    }
  });

  it('plans a job once: high first, blanks left out, repeated groups skipped', () => {
    const plan = planKeywords(keywords);
    expect(plan.groups.map((group) => `${group.priority}:${group.term}`)).toEqual([
      'high:Kubernetes',
      'high:Go',
      'high:.NET',
      'high:C#',
      'low:Node.js',
      'low:TS',
      'low:C++',
      'low:CI/CD',
      'low:Express',
    ]);
  });
});

describe('termPattern sticky option', () => {
  it('adds the y flag and matches only at lastIndex', () => {
    const pattern = termPattern('Go', { sticky: true })!;
    expect(pattern.flags).toBe('uy');
    pattern.lastIndex = 4;
    expect(pattern.test('use Go')).toBe(true);
    pattern.lastIndex = 0;
    expect(pattern.test('use Go')).toBe(false);
  });
});
