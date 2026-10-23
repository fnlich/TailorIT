import path from 'node:path';
import type { NextConfig } from 'next';

const webPort = process.env.WEB_PORT ?? '3100';
const apiOrigin = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '4100'}`;

const nextConfig: NextConfig = {
  // Next 16.3+ writes AGENTS.md / CLAUDE.md into the app when an AI agent starts `next dev`; the repository's own
  // docs are the instructions (same reasoning as free_tailor's next.config.ts).
  agentRules: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@tailorit/shared'],
  // The browser only ever talks to this origin; /api is proxied to Express so the session cookie is first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  experimental: {
    // The rewrite proxy defaults to a 30 s timeout. AI work is asynchronous (202 + polling), but exports and
    // uploads can still take a while.
    proxyTimeout: 120_000,
    // A persistent Turbopack build cache once served a stale globals.css in free_tailor; a cold compile is cheaper.
    turbopackFileSystemCacheForBuild: false,
  },
  allowedDevOrigins: [`localhost:${webPort}`, `127.0.0.1:${webPort}`],
  turbopack: {
    // Monorepo root, so packages/shared resolves.
    root: path.join(__dirname, '..', '..'),
  },
};

export default nextConfig;
