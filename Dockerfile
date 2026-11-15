# syntax=docker/dockerfile:1
#
# MedAI Bulgaria backend: FastAPI + the X-ray Analyzer (YOLO, CPU) + CLIP image
# triage (CPU). No GPU is needed or used.
#
# The build context is the REPOSITORY ROOT (this file lives there on purpose),
# so that both backend/ and models/ are available. On Railway, leave the backend
# service's root directory empty; the frontend has its own Dockerfile in frontend/.
#
#   docker build -t medai-backend .
#   docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... medai-backend

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    # Containers see the host's core count; cap the inference threads to the
    # vCPUs a small Railway service actually gets. Override per service if needed.
    OMP_NUM_THREADS=4

# OpenCV (a dependency of ultralytics) needs libGL and glib even without a display.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl ca-certificates \
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

# --- X-ray Analyzer weights ---------------------------------------------------
# The weights are not in git (see models/README.md). They are downloaded while
# building and verified against a pinned SHA-256, so the image always carries
# exactly the checked file. Railway passes service variables with these names
# into the build; set YOLO_WEIGHTS_URL to an empty string to build without a
# model (the app then runs with demo mode only).
ARG YOLO_WEIGHTS_URL="https://huggingface.co/jayanthapoojary1989/rsna-pneumonia-yolov8s/resolve/main/pytorch_yolov8_model.pt"
ARG YOLO_WEIGHTS_SHA256="a514f8e1706dcb640198e84813372cd122c57d3fa47b993a9a7900d247dbae43"
COPY --chown=medai:medai models/README.md /app/models/README.md
COPY --chown=medai:medai backend/ /app/backend/

USER medai

RUN if [ -n "$YOLO_WEIGHTS_URL" ]; then \
        curl -fsSL --retry 3 -o /app/models/medical_yolo.pt "$YOLO_WEIGHTS_URL" \
        && echo "$YOLO_WEIGHTS_SHA256  /app/models/medical_yolo.pt" | sha256sum -c - ; \
    fi

# --- CLIP triage model --------------------------------------------------------
# Baked into the image: Railway's filesystem is wiped on every deploy, and a
# fresh container must not download 600 MB before it can label an upload. The
# cache is written by the runtime user, so its lock files stay writable.
ENV IMAGE_TRIAGE_CACHE_DIR=/app/models/triage \
    YOLO_WEIGHTS_PATH=/app/models/medical_yolo.pt
RUN python prefetch_models.py

EXPOSE 8000
# Railway injects PORT. Exactly one worker: every worker would load its own copy
# of both models, and uploaded images live in the process that received them.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
