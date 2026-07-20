FROM node:22-slim AS base
# Prisma's engines link against libssl, which node:22-slim does not ship. The query engine only
# warns and falls back; the SCHEMA engine fails outright, so `prisma migrate deploy` dies with a
# bare "Schema engine error:" and the container restart-loops before the app ever starts. Installed
# in `base` so both the build and the runtime stage get it.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @eyo/api --frozen-lockfile
# Only apps/api. `ops/` is deliberately NOT copied: it holds the development licence key, whose
# private half is committed, and an image carrying it could be talked into accepting a
# self-minted licence with `-e NODE_ENV=development`. See apps/api/src/licence/licence-key.ts —
# the absence of that file is the guard, so do not add `COPY ops` for convenience.
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && pnpm build

# The image must contain no key material. Same invariant licence-key.spec.ts asserts over the
# source, asserted again over the build output, which catches anything reaching dist by a route the
# source scan cannot see.
#
# The pattern requires a base64 body after the marker, not the marker alone: licence-key.js
# legitimately contains `-----BEGIN PUBLIC KEY-----` inside the regex that extracts one, and a
# naive grep fails the build on it. `-z` so the match can span the newline.
RUN ! grep -rlEz -- '-----BEGIN [A-Z ]*KEY-----[\r\n]+[A-Za-z0-9+/=[:space:]]{40,}-----END' \
      /repo/apps/api/dist \
    || (echo 'FATAL: key material found in the build output' >&2 && exit 1)

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
