import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { jwtSecret } from './common/auth';

/**
 * Fail on the signing keys at startup, not at first use.
 *
 * `jwtSecret()` refuses to hand back a production key that was never set — but it is only called
 * when a token is signed or verified, so on its own it turns a misconfigured deploy into an
 * application that starts cleanly, reports itself healthy, and then fails every single sign-in.
 * Reading it here converts that into what it actually is: a deployment that must not start. The
 * WhatsApp provider check does the same thing for the same reason.
 */
function assertSigningKeys() {
  jwtSecret();
}

async function bootstrap() {
  assertSigningKeys();
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
