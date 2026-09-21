# Multi-stage build. Node 24 to match .github/workflows/ci.yml. The final `runner` stage
# ships only Next.js's traced `standalone` output (see next.config.ts) — a pruned
# node_modules subset plus server.js — not the full dev dependency tree; `migrate` (in
# docker-compose.yml) targets the `builder` stage instead, since it needs the full
# devDependencies (node-pg-migrate, dotenv) that the pruned runtime image deliberately drops.

FROM node:24-alpine AS deps
WORKDIR /app
# P1-10a: every workspace manifest is needed for `npm ci` to resolve the tree, and the lockfile
# describes all three. Copying only the root package.json would make npm ci fail on the
# `@b8/contracts` link rather than on anything informative.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/contracts/package.json ./packages/contracts/
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# P1-10a CHANGED THESE PATHS, and the standalone layout with them. `outputFileTracingRoot` is the
# repo root, so Next nests the app under its own path inside the output and hoists node_modules
# beside it:
#
#   apps/web/.next/standalone/apps/web/server.js
#   apps/web/.next/standalone/node_modules/
#
# Copying the standalone tree to /app therefore puts server.js at /app/apps/web/server.js, which is
# why WORKDIR moves below rather than staying at /app.
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000
ENV PORT=3000
# MUST be set explicitly. Next's standalone `server.js` uses `process.env.HOSTNAME` as its BIND
# ADDRESS, and Docker automatically sets HOSTNAME to the container id — so without this line the
# server binds to the container's own name and nothing else, which was measured: from inside the
# container `http://127.0.0.1:3000` was refused while `http://<container-id>:3000` answered. Port
# publishing still worked, so the fault was invisible from the host; a health check or a sidecar
# talking to loopback would have found it the hard way.
ENV HOSTNAME=0.0.0.0
# Deliberately 0.0.0.0, not the 127.0.0.1 the bare `next start -H 127.0.0.1` script uses —
# Docker's port publishing connects from outside the container's network namespace, so a
# loopback-only bind here would make the app unreachable even from the host. The
# 127.0.0.1-only constraint is enforced instead at the docker-compose.yml port-publish
# level (`127.0.0.1:3000:3000`), which is the equivalent guarantee for a container.
CMD ["node", "server.js"]
