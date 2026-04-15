# =====================================
# ChurchFinance - Next.js + Prisma Dockerfile (final version)
# Works on macOS + Linux (Dokploy safe)
# =====================================

# ---------- Build Stage ----------
FROM node:20-bullseye AS builder
WORKDIR /app

# Copy dependency files
COPY package*.json .npmrc ./

# Install dependencies (including devDeps for Tailwind + Prisma)
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# Copy app source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build production output
RUN DISABLE_TS_CHECK=1 SKIP_ENV_VALIDATION=1 npm run build

# ---- New Relic deps (isolated, no npm cache in final image) ----
FROM node:20-slim AS newrelic-deps
WORKDIR /nr
RUN echo '{"dependencies":{"newrelic":"^13.18.0"}}' > package.json
RUN npm install --omit=dev --ignore-scripts 2>&1 | tail -1

# ---------- Runtime Stage ----------
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy necessary runtime files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=newrelic-deps /nr/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
