/** @type {import('next').NextConfig} */
export default {
  /**
   * `@eyo/shared` ships TypeScript source rather than a build. Next compiles it in place, which is
   * why the portal can depend on the licence format directly while the school's API — built with
   * tsc and run as plain node — still carries its own copy. See format-parity.spec.ts in the API,
   * which is what stops the two drifting until the shared package earns a build step.
   */
  transpilePackages: ['@eyo/shared'],
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};
