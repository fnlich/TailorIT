import { defineConfig } from 'tsup';

// Production bundle of the API. Internal workspace packages are source-only TypeScript, so they are
// bundled in; native and browser-driving modules stay external and load from node_modules at runtime.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@tailorit\//],
  external: ['better-sqlite3', 'puppeteer-core', '@puppeteer/browsers', 'pdf-parse', '@napi-rs/canvas', 'pdfjs-dist'],
});
