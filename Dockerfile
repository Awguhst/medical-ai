# syntax=docker/dockerfile:1
#
# MedAI Bulgaria, the whole app in one image: the Next.js frontend as static
# files, served by the FastAPI backend next to the API, plus the CLIP image
# triage model (CPU). No GPU is needed or used.
#
# The build context is the REPOSITORY ROOT (this file lives there on purpose).
# On Railway, connect the repository and leave the root directory empty.
#
#   docker build -t medai .
#   docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... medai
#   -> http://localhost:8000

# --- Stage 1: the frontend, as static files -----------------------------------
FROM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts has output: "export"; the result lands in /src/out.
RUN npm run build

# --- Stage 2: the API, which also serves those files --------------------------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    # Containers see the host's core count; cap the inference threads to the
    # vCPUs a small Railway service actually gets. Override per service if needed.
    OMP_NUM_THREADS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The app runs as an unprivileged user. It is created now, and everything it
# must own is written as that user below: a `chown -R` at the end would copy
# the 600 MB model cache into an extra image layer.
RUN useradd --create-home --uid 1000 medai \
    && mkdir -p /app/backend /app/models \
    && chown medai:medai /app/models

WORKDIR /app/backend

# CPU-only PyTorch first. The default PyPI wheel drags in several gigabytes of
# CUDA libraries that no Railway machine can use.
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY --chown=medai:medai models/README.md /app/models/README.md
COPY --chown=medai:medai backend/ /app/backend/
COPY --from=frontend --chown=medai:medai /src/out /app/frontend_dist

USER medai

# --- CLIP triage model --------------------------------------------------------
# Baked into the image: Railway's filesystem is wiped on every deploy, and a
# fresh container must not download 600 MB before it can label an upload. The
# cache is written by the runtime user, so its lock files stay writable.
ENV IMAGE_TRIAGE_CACHE_DIR=/app/models/triage \
    FRONTEND_DIST=/app/frontend_dist
RUN python prefetch_models.py

EXPOSE 8000
# Railway injects PORT. Exactly one worker: every worker would load its own copy
# of the triage model, and uploaded images live in the process that received them.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
