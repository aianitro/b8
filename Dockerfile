# Multi-stage build. Node 24 to match .github/workflows/ci.yml. The final `runner` stage
# ships only Next.js's traced `standalone` output (see next.config.ts) — a pruned
# node_modules subset plus server.js — not the full dev dependency tree; `migrate` (in
# docker-compose.yml) targets the `builder` stage instead, since it needs the full
# devDependencies (node-pg-migrate, dotenv) that the pruned runtime image deliberately drops.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
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
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
# Deliberately 0.0.0.0, not the 127.0.0.1 the bare `next start -H 127.0.0.1` script uses —
# Docker's port publishing connects from outside the container's network namespace, so a
# loopback-only bind here would make the app unreachable even from the host. The
# 127.0.0.1-only constraint is enforced instead at the docker-compose.yml port-publish
# level (`127.0.0.1:3000:3000`), which is the equivalent guarantee for a container.
CMD ["node", "server.js"]
