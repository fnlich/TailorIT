// Links a person typed, made safe to put in an href. The live preview renders whatever is in the editor as it is
// typed, and Handlebars escapes quotes, not schemes: a `javascript:` or `data:` link would be a link that runs
// something. So only http(s) survives; a bare host ("linkedin.com/in/x") gets https; anything else that names a
// scheme is dropped, and so is any value holding a control character (a browser deletes tabs and newlines from an
// href before parsing it, so "java<TAB>script:" would otherwise slip through).

/** An http(s) URL for the value, or '' when it is not safe to link. */
export function externalUrl(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  let candidate: string;
  if (/^https?:\/\//i.test(trimmed)) candidate = trimmed;
  else if (scheme && !scheme[1]!.includes('.')) return '';
  else candidate = `https://${trimmed.replace(/^\/+/, '')}`;
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'http:' || protocol === 'https:' ? candidate : '';
  } catch {
    return '';
  }
}

/** How a link prints: host and path, no scheme, no "www.", no trailing slash; '' when it is not safe. */
export function externalUrlDisplay(value: unknown): string {
  const url = externalUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    return `${host}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/$/, '');
  } catch {
    return url
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '');
  }
}

/** A contact link kept as typed when it is safe to link, else ''. */
export function safeContactLink(value: unknown): string {
  return externalUrl(value) ? (typeof value === 'string' ? value.trim() : '') : '';
}
