import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { booleanParam, listParam, numberParam, paramValues, queryBoolean, queryEnum, queryList } from './params';
import { decodeHtmlEntities, escapeHtml, htmlToText, pluralize, tidyText, truncateText } from './text';

describe('html text', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('a&amp;b &lt;3 &#39;x&#39; &#x2014; &nbsp;&unknown;')).toBe("a&b <3 'x' — \u00a0&unknown;");
  });

  it('turns HTML into readable lines', () => {
    const html = '<h1>Title</h1><p>First&nbsp;line<br>second</p><ul><li>One</li><li>Two</li></ul><script>x()</script>';
    expect(htmlToText(html)).toBe('Title\nFirst line\nsecond\n\n- One\n- Two');
  });

  it('tidies display strings', () => {
    expect(tidyText('  Jane \n  Doe ')).toBe('Jane Doe');
    expect(tidyText(42)).toBe('');
  });

  it('truncates with an ellipsis only when cut', () => {
    expect(truncateText('abcdef', 3)).toBe('abc...');
    expect(truncateText('abc', 3)).toBe('abc');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'app')).toBe('1 app');
    expect(pluralize(2, 'app')).toBe('2 apps');
    expect(pluralize(0, 'entry', 'entries')).toBe('0 entries');
  });
});

describe('query params', () => {
  it('reads lists from repeats and commas', () => {
    expect(listParam(['a,b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(listParam('San Francisco, CA', false)).toEqual(['San Francisco, CA']);
    expect(listParam(undefined)).toEqual([]);
  });

  it('reads flags and numbers leniently', () => {
    expect(booleanParam('1')).toBe(true);
    expect(booleanParam('off')).toBe(false);
    expect(booleanParam('maybe')).toBeUndefined();
    expect(numberParam('120000')).toBe(120000);
    expect(numberParam('12k')).toBeUndefined();
  });

  it('reads values from URLSearchParams-like and plain records', () => {
    const reader = { getAll: (name: string) => (name === 'type' ? ['a', 'b'] : []) };
    expect(paramValues(reader, 'type')).toEqual(['a', 'b']);
    expect(paramValues({ type: ['a', 2] }, 'type')).toEqual(['a', '2']);
  });

  it('drops unknown items in zod list and enum fields', () => {
    const schema = z.object({
      types: queryList(z.enum(['x', 'y'])),
      sort: queryEnum(['a', 'b'] as const),
      on: queryBoolean,
    });
    expect(schema.parse({ types: 'x,zz,y', sort: 'q', on: 'yes' })).toEqual({ types: ['x', 'y'], sort: undefined, on: true });
  });
});
