import Handlebars from 'handlebars';

// The engine's own Handlebars environment, isolated from the global one so registering helpers here can never
// change another package's templates. Templates may use the built-in helpers (each, if, unless, with, lookup) and
// two of ours: `join` and `formatDate` (identity: dates print as typed).

export const handlebars = Handlebars.create();

handlebars.registerHelper('join', (list: unknown, separator: unknown) => {
  if (!Array.isArray(list)) return '';
  return list.join(typeof separator === 'string' && separator ? separator : ', ');
});

handlebars.registerHelper('formatDate', (date: unknown) => date);

/** Whether the markup parses as Handlebars (blocks balanced and named alike). Compiling is lazy; this is not. */
export function parsesAsHandlebars(markup: string): boolean {
  try {
    handlebars.parse(markup);
    return true;
  } catch {
    return false;
  }
}

/** Handlebars' HTML escaping, the same function the templates' `{{ }}` use. */
export function escapeHtml(value: string): string {
  return handlebars.escapeExpression(value);
}
