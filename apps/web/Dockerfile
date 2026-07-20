FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @eyo/web --frozen-lockfile
COPY apps/web apps/web

# Version skew protection. Every deploy rebuilds this image, and a rebuild changes the ids Next
# gives its Server Functions — so a page someone already had open submits a form against an id the
# new server has never heard of, and the action fails silently. Stamping the build with the commit
# makes the mismatch detectable: assets carry ?dpl=<id>, navigations carry an x-deployment-id
# header, and a client on an old build gets a full reload instead of a broken form.
#
# Build-time, not runtime: the id is baked into the output that references it. Left empty the
# feature is simply off, which is the right default for a local `docker build`.
ARG NEXT_DEPLOYMENT_ID=""
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
RUN cd apps/web && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
