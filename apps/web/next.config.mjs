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
  eslint: { ignoreDuringBuilds: true },
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};
