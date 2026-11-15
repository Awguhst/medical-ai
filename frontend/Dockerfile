# syntax=docker/dockerfile:1
#
# MedAI Bulgaria frontend (Next.js, standalone output).
# Build context is the frontend/ directory. On Railway, set the frontend
# service's root directory to /frontend so this Dockerfile is detected.
#
# The backend address is a RUNTIME setting: set API_URL on the container and
# the server injects it into every page. The image itself is backend-agnostic.
#
#   docker build -t medai-frontend frontend
#   docker run --rm -p 3000:3000 -e API_URL=https://api.example.com medai-frontend

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Optional: bake a default backend URL into the browser bundle. Normally left
# empty; the runtime API_URL variable takes precedence anyway.
ARG NEXT_PUBLIC_API_URL=""
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
# Railway injects PORT; the standalone server reads PORT and HOSTNAME. Set
# API_URL to the backend's public URL (the browser calls it directly).
CMD ["node", "server.js"]
