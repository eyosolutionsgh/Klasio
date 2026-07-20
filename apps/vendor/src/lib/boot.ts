import { parseEncryptionKey } from './crypto';

/**
 * What this deployment must be given before it is allowed to serve anything.
 *
 * Checked at boot rather than at first use. A portal that starts happily and then fails the first
 * time somebody enrols an authenticator has told nobody anything useful: the failure lands on a
 * member of staff, at the worst moment, looking like a bug in the product.
 *
 * Pure, so the awkward part — a key that is present but the wrong size — is testable without
 * starting a server.
 */
export interface BootEnv {
  NODE_ENV?: string;
  VENDOR_ENCRYPTION_KEY?: string;
  VENDOR_SESSION_SECRET?: string;
  VENDOR_DATABASE_URL?: string;
}

export function isProduction(env: BootEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Everything wrong with this deployment's secrets, in sentences somebody can act on.
 *
 * All of them, not the first: whoever is bringing a server up should learn everything they have to
 * fix in one go rather than discovering them one restart at a time.
 *
 * Outside production nothing is required — every one of these has a documented development
 * fallback, and a portal a developer cannot start is a portal nobody works on.
 */
export function secretProblems(env: BootEnv): string[] {
  if (!isProduction(env)) return [];
  const problems: string[] = [];

  // `||` not `??` throughout: an unset variable arrives from compose and CI as the empty string.
  const encryption = env.VENDOR_ENCRYPTION_KEY || undefined;
  if (!encryption) {
    problems.push(
      'VENDOR_ENCRYPTION_KEY is not set. It encrypts staff authenticator secrets at rest — ' +
        'without it this server would fall back to a key published in the repository. ' +
        'Generate one with: openssl rand -hex 32',
    );
  } else if (!parseEncryptionKey(encryption)) {
    // Present but unusable is the more dangerous case: a presence check would have passed it.
    problems.push(
      'VENDOR_ENCRYPTION_KEY is set but is not 32 bytes (64 hex characters, or base64 of 32 bytes).',
    );
  }

  if (!(env.VENDOR_SESSION_SECRET || undefined)) {
    problems.push(
      'VENDOR_SESSION_SECRET is not set. It signs staff session cookies, and without it anyone ' +
        'could mint one. Generate with: openssl rand -hex 32',
    );
  }

  if (!(env.VENDOR_DATABASE_URL || undefined)) {
    problems.push('VENDOR_DATABASE_URL is not set. This portal has no database to read.');
  }

  /*
    Deliberately absent: VENDOR_SIGNING_KEY.

    A portal with no signing key is a supported way to run — it tracks licences and heartbeats
    without issuing anything, which is a reasonable read-only replica. Requiring it here would
    outlaw that, and the UI already says plainly when issuing is unavailable.
  */

  return problems;
}

export class InsecureDeploymentError extends Error {
  constructor(problems: string[]) {
    super(
      `Refusing to start. This production deployment is missing secrets it needs:\n\n` +
        problems.map((p) => `  • ${p}`).join('\n\n') +
        `\n\nSet them and start again. See apps/vendor/.env.example.`,
    );
    this.name = 'InsecureDeploymentError';
  }
}

/** Throws rather than warns: a warning in a boot log is a warning nobody reads. */
export function assertSecrets(env: BootEnv = process.env): void {
  const problems = secretProblems(env);
  if (problems.length > 0) throw new InsecureDeploymentError(problems);
}
