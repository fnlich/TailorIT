import { createApp, setupServices, startFeatures } from './app';
import { createRuntimeDeps } from './deps';

async function main(): Promise<void> {
  const deps = createRuntimeDeps();
  const { config, log } = deps;
  setupServices(deps);
  const app = createApp(deps);

  const server = app.listen(config.apiPort, '127.0.0.1', () => {
    log.info(`[api] listening on http://127.0.0.1:${config.apiPort} (data: ${config.dataDir})`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      log.error(`[api] port ${config.apiPort} is already in use. Stop the other process or change API_PORT in .env.`);
    } else {
      log.error('[api] server error', error);
    }
    process.exit(1);
  });

  const stopFeatures = startFeatures(deps);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`[api] ${signal}: shutting down`);
    await stopFeatures();
    server.close(() => {
      deps.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
