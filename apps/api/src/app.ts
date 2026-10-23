import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { attachUser } from './core/auth/session';
import type { AppDeps } from './core/context';
import type { Feature } from './core/feature';
import { errorHandler, notFoundHandler } from './core/http/errors';
import { noStore, originCheck, requestId } from './core/http/middleware';
import { FEATURES } from './features/index';

/** Creates every feature's services on `deps.services`, in list order. */
export function setupServices(deps: AppDeps, features: Feature[] = FEATURES): void {
  for (const feature of features) feature.services?.(deps);
}

/** Builds the Express app. The browser reaches it only through Next's /api rewrite (same origin). */
export function createApp(deps: AppDeps, features: Feature[] = FEATURES): Express {
  const app = express();
  app.disable('x-powered-by');
  // Next's rewrite proxy runs on the same machine; trust its X-Forwarded-* so req.secure/req.ip are right.
  app.set('trust proxy', 'loopback');
  // Content-Security-Policy is set per response by the routes that return HTML (previews); JSON needs none.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(requestId);
  app.use('/api', noStore);
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(originCheck(deps.config.appOrigin));
  app.use(attachUser(deps));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'tailorit-api', time: deps.now().toISOString() });
  });

  for (const feature of features) {
    for (const route of feature.routes ?? []) app.use(route.path, route.router(deps));
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler(deps.log));
  return app;
}

/** Starts every feature's background work; returns one function that stops it all (reverse order). */
export function startFeatures(deps: AppDeps, features: Feature[] = FEATURES): () => Promise<void> {
  const stops: Array<() => void | Promise<void>> = [];
  for (const feature of features) {
    const stop = feature.start?.(deps);
    if (typeof stop === 'function') stops.push(stop);
  }
  return async () => {
    for (const stop of stops.reverse()) {
      try {
        await stop();
      } catch (error) {
        deps.log.error('[api] a feature failed to stop cleanly', error);
      }
    }
  };
}
