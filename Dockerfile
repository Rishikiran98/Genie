# Genie production image: multi-stage, Next.js standalone output, non-root.
#
#   docker build -t genie .
#   docker run --rm -p 3000:3000 genie                       # zero-config (offline engine, browser storage)
#   docker run --rm -p 3000:3000 --env-file .env.local genie # with LLM / Supabase / limits configured
#
# NEXT_PUBLIC_* values are inlined at build time, so pass them as --build-arg
# when you want the Supabase backend baked into the client bundle.

# ---- deps: install exactly what package-lock.json pins ----------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: compile the standalone server ----------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- run: only the standalone bundle, as an unprivileged user ---------------
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S genie && adduser -S -G genie genie

COPY --from=build --chown=genie:genie /app/.next/standalone ./
COPY --from=build --chown=genie:genie /app/.next/static ./.next/static
COPY --from=build --chown=genie:genie /app/public ./public

USER genie
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
