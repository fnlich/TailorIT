import { describe, expect, it } from 'vitest';
import { neighboursOf, readStartChoice, startResumeHref, templateFilters, templatesForFilter } from './gallery';

const templates = [
  { id: 'a', category: 'simple' as const },
  { id: 'b', category: 'creative' as const },
  { id: 'c', category: null },
  { id: 'd', category: 'ats' as const },
];

describe('template chooser', () => {
  it('offers All Templates, then only the categories some template has, in the catalogue order', () => {
    expect(templateFilters(templates)).toEqual(['all', 'simple', 'creative', 'ats']);
    expect(templateFilters([])).toEqual(['all']);
  });

  it('filters by category; an uncategorised template shows under All only', () => {
    expect(templatesForFilter(templates, 'all').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(templatesForFilter(templates, 'creative').map((t) => t.id)).toEqual(['b']);
  });

  it('links a template to the editor, naming the layout only for Plain', () => {
    expect(startResumeHref('navy-rule')).toBe('/resumes/new?template=navy-rule');
    expect(startResumeHref('navy rule', 'flat')).toBe('/resumes/new?template=navy+rule&layout=flat');
  });

  it('reads the address back against the offered templates', () => {
    expect(readStartChoice({ template: null, layout: null }, templates)).toBeNull();
    expect(readStartChoice({ template: '', layout: 'flat' }, templates)).toEqual({ templateId: '', layout: 'flat' });
    expect(readStartChoice({ template: 'b', layout: 'weird' }, templates)).toEqual({ templateId: 'b', layout: 'categorized' });
    expect(readStartChoice({ template: 'gone', layout: null }, templates)).toBeNull();
    expect(readStartChoice({ template: 'gone', layout: null }, null)).toEqual({ templateId: 'gone', layout: 'categorized' });
  });

  it('finds the previous and next template', () => {
    expect(neighboursOf(templates, 'a')).toEqual({ previous: null, next: templates[1] });
    expect(neighboursOf(templates, 'd')).toEqual({ previous: templates[2], next: null });
    expect(neighboursOf(templates, 'zz')).toEqual({ previous: null, next: null });
  });
});
