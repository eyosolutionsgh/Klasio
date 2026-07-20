FROM node:22-slim AS base
# Prisma's engines link against libssl, which node:22-slim does not ship — see apps/api/Dockerfile
# for the failure it causes. This image runs `prisma migrate deploy` at start too, so it needs the
# same fix rather than living on the query engine's warning-and-fall-back.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# @eyo/shared too, and the trailing `...` on the filter to pull in workspace dependencies.
# The vendor app is the only one that imports it (the licence byte layout and the entitlement
# catalogue live there), which is why the api and web images build without it and this one does
# not. It is raw TypeScript — `main` points at src/index.ts and there is no build step — so the
# source has to be present at build time, not just a compiled artifact.
COPY packages/shared/package.json packages/shared/
COPY apps/vendor/package.json apps/vendor/
RUN pnpm install --filter @eyo/vendor... --frozen-lockfile
# apps/vendor and packages/shared, and nothing else. `ops/` is deliberately NOT copied, for a
# sharper reason than in the API image: ops/licence/dev-signing-key.pem is the PRIVATE half of the
# development pair, and this is the service that signs licences. An image carrying it could mint a
# licence every school's API would accept. The real key is mounted at runtime
# (VENDOR_SIGNING_KEY_PATH) and never baked in.
COPY packages/shared packages/shared
COPY apps/vendor apps/vendor

# No VENDOR_DATABASE_URL here on purpose: src/lib/db.ts builds its client on first query rather
# than at import, so compiling needs no database at all. If this build ever fails again on
# "Invalid value undefined for datasource db", something has started constructing a client at
# module load — fix that rather than feeding the build a placeholder URL.
RUN cd apps/vendor && npx prisma generate && pnpm build

# The same invariant apps/api/Dockerfile asserts over dist, asserted here over .next. Catches key
# material reaching the build output by any route a source scan cannot see.
#
# The pattern requires a base64 body after the marker, not the marker alone — code that merely
# mentions `-----BEGIN PUBLIC KEY-----` inside a regex is legitimate and must not fail the build.
# `-z` so the match can span the newline.
RUN ! grep -rlEz -- '-----BEGIN [A-Z ]*KEY-----[\r\n]+[A-Za-z0-9+/=[:space:]]{40,}-----END' \
      /repo/apps/vendor/.next \
    || (echo 'FATAL: key material found in the build output' >&2 && exit 1)

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/vendor
EXPOSE 3200
CMD ["sh", "-c", "npx prisma migrate deploy && pnpm start"]
