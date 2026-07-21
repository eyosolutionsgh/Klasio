import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { jwtSecret } from '../src/common/auth';

/**
 * Vercel-only entrypoint. `src/main.ts` (the on-prem/DigitalOcean/any-VM bootstrap, a plain
 * `app.listen()`) is untouched and stays the entrypoint everywhere else — this file exists
 * because a Vercel Function is request-scoped and cannot hold an open listener.
 *
 * A Vercel Node Function is invoked as a plain `(req, res)` handler — the exact shape an Express
 * app already is — so no Lambda-style event/context adapter is needed here, just the app's own
 * HTTP handler passed straight through.
 *
 * The Nest app is built once and cached at module scope, so it survives across invocations of
 * the same warm Function instance instead of re-bootstrapping (and re-running onModuleInit,
 * including the licence service's timers) on every request.
 */
type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

let cachedHandler: HttpHandler | undefined;

async function bootstrapServer(): Promise<HttpHandler> {
  jwtSecret();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cachedHandler) cachedHandler = await bootstrapServer();
  cachedHandler(req, res);
}
