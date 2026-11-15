# syntax=docker/dockerfile:1
#
# MedAI Bulgaria frontend (Next.js, standalone output).
# Build context is the frontend/ directory. On Railway, set the frontend
# service's root directory to /frontend so this Dockerfile is detected.
#
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t medai-frontend frontend
#   docker run --rm -p 3000:3000 medai-frontend

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so the
# backend's public URL must be known here. Railway passes a service variable of
# the same name into the build when it is declared with ARG.
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" \
    || { echo "NEXT_PUBLIC_API_URL must be set at build time (the backend's public URL)."; exit 1; }
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# Railway injects PORT; the standalone server reads PORT and HOSTNAME.
CMD ["node", "server.js"]
