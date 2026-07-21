/**
 * Boots the real API in-process and talks to it over real HTTP.
 *
 * Deliberately not `Test.createTestingModule` with mocked providers: the bugs this suite exists
 * to catch live in the seam between the guard, the tenant interceptor and Postgres. Anything
 * that stubs the database out cannot see them — both shipped past a green unit-test run.
 *
 * Requests go over the socket rather than through `app.getHttpServer()` handles because gateway
 * webhook signatures are verified over the exact bytes received, and only a real request has
 * a real `rawBody`.
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import type { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module';
import { signToken } from '../../src/common/auth';
import { OTHER_SCHOOL_SLUG, ownerUrl } from './env';

export interface Api {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startApi(): Promise<Api> {
  const app: INestApplication = await NestFactory.create(AppModule, {
    // Silence the boot banner; a failing assertion is the signal, not 40 lines of route logging.
    logger: ['error'],
    rawBody: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/**
 * Owner-level client for arranging fixtures and checking results.
 *
 * Assertions read through the OWNER precisely because policies do not apply to it: a test that
 * verified its own writes through the tenant-scoped client could not tell "the row was never
 * written" from "the row is hidden from me".
 */
export function ownerDb(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
}

export interface Res<T = unknown> {
  status: number;
  body: T;
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  /** Pre-serialised body, for webhook payloads whose exact bytes are signed. */
  raw?: Buffer;
  headers?: Record<string, string>;
}

export async function call<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let payload: string | Buffer | undefined;
  if (opts.raw) {
    payload = opts.raw;
    headers['content-type'] ??= 'application/json';
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  // Buffer is a Uint8Array, but BodyInit will not take one whose buffer might be shared.
  // Uint8Array.from copies into a plain ArrayBuffer, which it accepts — same bytes either way,
  // and the raw bytes are the point here: the webhook specs sign exactly what is sent.
  const requestBody =
    typeof payload === 'string' || payload === undefined ? payload : Uint8Array.from(payload);
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: requestBody });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text — an unexpected HTML error page is more useful unparsed */
  }
  return { status: res.status, body: body as T };
}

/** The demo school the seed creates, plus a signed token for its owner. */
export async function seededSchool(db: PrismaClient) {
  const school = await db.school.findFirstOrThrow({ where: { slug: 'brighton-academy' } });
  const owner = await db.user.findFirstOrThrow({ where: { schoolId: school.id, role: 'OWNER' } });
  const token = signToken({
    sub: owner.id,
    schoolId: school.id,
    role: owner.role,
    tier: school.tier,
    name: owner.name,
  });
  return { school, owner, token };
}

/**
 * A second, minimal tenant. Cross-tenant tests need a real school id that the demo school's
 * principal has no claim to; without one, "refused" and "no such row" look identical.
 */
export async function otherSchool(db: PrismaClient) {
  const slug = OTHER_SCHOOL_SLUG;
  const school =
    (await db.school.findFirst({ where: { slug } })) ??
    (await db.school.create({ data: { name: 'Other School', slug, tier: 'MEDIUM' } }));
  const email = 'owner@other.integration';
  const owner =
    (await db.user.findFirst({ where: { email } })) ??
    (await db.user.create({
      data: {
        schoolId: school.id,
        name: 'Other Owner',
        email,
        passwordHash: 'not-a-real-hash',
        role: 'OWNER',
      },
    }));
  const student =
    (await db.student.findFirst({ where: { schoolId: school.id } })) ??
    (await db.student.create({
      data: {
        schoolId: school.id,
        admissionNo: 'OTH-0001',
        firstName: 'Ama',
        lastName: 'Mensah',
        gender: 'FEMALE',
        dateOfBirth: new Date('2015-04-02'),
      },
    }));
  const token = signToken({
    sub: owner.id,
    schoolId: school.id,
    role: 'OWNER',
    tier: school.tier,
    name: owner.name,
  });
  return { school, owner, student, token };
}
