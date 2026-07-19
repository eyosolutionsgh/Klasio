/**
 * A value that changes whenever the app is rebuilt.
 *
 * The service worker names its cache after this and registers at `/sw.js?v=<id>`, which is what
 * makes a deploy rotate the cache instead of serving the previous build's assets forever.
 *
 * CI should set BUILD_ID to the commit sha, so the same source produces the same id. Without it
 * the build time is used: that changes on every build, which at worst re-fetches the shell once
 * more than strictly necessary — wrong in the safe direction.
 */
const buildId = process.env.BUILD_ID ?? String(Date.now());

/** @type {import('next').NextConfig} */
export default {
  /**
   * Two servers must never share a build directory. A `next start` holds a build id, and a dev
   * server running from the same `.next` overwrites the assets that id points at — the served
   * pages then come back with no stylesheet and no hydration, which looks like a broken app
   * rather than a broken setup. Giving the e2e build its own directory keeps a dev server the
   * user is already running out of its way.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};
