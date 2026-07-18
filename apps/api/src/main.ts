import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is required to verify gateway webhook signatures over the exact bytes received
  // (Paystack signs the raw payload with HMAC-SHA512) — see payments module.
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`EYO SMS API listening on :${port}`);
}
bootstrap();
