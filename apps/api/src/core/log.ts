export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level: LogLevel = 'info', sink: Pick<Console, 'log' | 'warn' | 'error'> = console): Logger {
  const enabled = (l: LogLevel) => ORDER[l] >= ORDER[level];
  const format = (detail: unknown) => {
    if (detail === undefined) return '';
    if (detail instanceof Error) return ` ${detail.stack ?? detail.message}`;
    try {
      return ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    } catch {
      return ` ${String(detail)}`;
    }
  };
  return {
    debug: (m, d) => enabled('debug') && sink.log(`debug ${m}${format(d)}`),
    info: (m, d) => enabled('info') && sink.log(`${m}${format(d)}`),
    warn: (m, d) => enabled('warn') && sink.warn(`warn ${m}${format(d)}`),
    error: (m, d) => enabled('error') && sink.error(`error ${m}${format(d)}`),
  } as Logger;
}

/** A logger that records lines (tests). */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string) => (m: string, d?: unknown) => {
    lines.push(`${prefix}${m}${d === undefined ? '' : ` ${d instanceof Error ? d.message : JSON.stringify(d)}`}`);
  };
  return { lines, debug: push('debug '), info: push(''), warn: push('warn '), error: push('error ') };
}
