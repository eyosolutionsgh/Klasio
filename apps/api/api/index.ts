import 'reflect-metadata';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import serverlessExpress from '@codegenie/serverless-express';
import { AppModule } from '../src/app.module';
import { jwtSecret } from '../src/common/auth';

/**
 * Vercel-only entrypoint. `src/main.ts` (the on-prem/DigitalOcean/any-VM bootstrap, a plain
 * `app.listen()`) is untouched and stays the entrypoint everywhere else — this file exists
 * because a Vercel Function is request-scoped and cannot hold an open listener.
 *
 * The Nest app is built once and cached at module scope, so it survives across invocations of
 * the same warm Function instance instead of re-bootstrapping (and re-running onModuleInit,
 * including the licence service's timers) on every request.
 */
type ServerlessHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

let cachedHandler: ServerlessHandler | undefined;

async function bootstrapServer(): Promise<ServerlessHandler> {
  jwtSecret();
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cachedHandler) cachedHandler = await bootstrapServer();
  return cachedHandler(req, res);
}
