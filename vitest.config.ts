import { defineConfig } from 'vitest/config';

// One runner for unit and API tests across the workspaces. Playwright covers the browser (e2e/, playwright.config.ts).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'render',
          root: './packages/render',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
