"""MedAI Bulgaria — FastAPI backend.

Run from this directory:

    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from dotenv import dotenv_values

from config import BACKEND_DIR, PROJECT_ROOT, Settings, get_settings
from i18n import parse_language, tr
from models.schemas import HealthResponse, ImageReaderHealth, ImageTriageHealth
from routers import chat, uploads
from services.image_service import get_image_store
from services.image_triage_service import get_image_triage_service
from services.tool_registry import get_registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# Request/response bodies are never logged; keep the HTTP client quiet as well.
for noisy in ("httpx", "httpx2", "httpcore", "httpcore2", "anthropic"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
logger = logging.getLogger("medai")


def _frontend_dist():
    """The Next.js static export, when it sits next to the API (the Docker image
    puts it there), so that one process serves the whole app from one address."""
    dist = get_settings().frontend_dist
    return dist if dist is not None and (dist / "index.html").is_file() else None


def _claude_key_source() -> str:
    """Where the Claude key in use came from. A key already present in the
    process environment wins over .env (dotenv does not override), which is
    easy to miss when the server is launched from a shell that sets one."""
    settings = get_settings()
    if not settings.claude_configured:
        return "none"
    file_key = dotenv_values(PROJECT_ROOT / ".env").get("ANTHROPIC_API_KEY") or dotenv_values(
        BACKEND_DIR / ".env"
    ).get("ANTHROPIC_API_KEY")
    return ".env" if settings.anthropic_api_key == (file_key or "").strip() else "environment"


async def _cleanup_loop() -> None:
    store = get_image_store()
    while True:
        await asyncio.sleep(300)
        removed = store.cleanup_expired()
        if removed:
            logger.info("removed %d expired temporary image(s)", removed)


def _image_reader_health(settings: Settings) -> ImageReaderHealth:
    """The Claude vision reader behind analyze_image needs nothing but the API key."""
    model = settings.anthropic_model
    if not settings.image_reader_enabled:
        return ImageReaderHealth(status="disabled", detail="Disabled with IMAGE_READER_ENABLED=false.", model=model)
    if not settings.claude_configured:
        return ImageReaderHealth(status="not_configured", detail="ANTHROPIC_API_KEY is not set.", model=model)
    return ImageReaderHealth(status="ready", detail="Images are described by Claude vision.", model=model)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    store = get_image_store()
    triage = get_image_triage_service()
    logger.info(
        "MedAI backend starting | claude_configured=%s key_source=%s model=%s | image_reader=%s | image_triage=%s",
        settings.claude_configured, _claude_key_source(), settings.anthropic_model,
        _image_reader_health(settings).status, triage.status().status,
    )
    dist = _frontend_dist()
    logger.info(
        "frontend: %s",
        f"served by this process from {dist}" if dist else "not bundled (run the Next.js dev server separately)",
    )
    if triage.enabled:
        # Load the vision transformer off the event loop so the first upload is quick.
        threading.Thread(target=triage.warm_up, name="image-triage-warmup", daemon=True).start()
    task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        store.shutdown()  # uploaded medical images never outlive the process


app = FastAPI(title="MedAI Bulgaria API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(get_settings().frontend_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Id", "Accept-Language"],
)

app.include_router(chat.router)
app.include_router(uploads.router)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if not isinstance(detail, dict):
        detail = {"code": "http_error", "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Field locations only — never echo submitted values back or into logs.
    fields = sorted({".".join(str(p) for p in err.get("loc", ())[1:]) for err in exc.errors()})
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_request",
                "message": tr(parse_language(request.headers.get("accept-language")), "invalid_request"),
                "fields": fields,
            }
        },
    )


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    triage = get_image_triage_service().status()
    return HealthResponse(
        status="ok",
        claude_configured=settings.claude_configured,
        claude_key_source=_claude_key_source(),  # type: ignore[arg-type]
        claude_model=settings.anthropic_model,
        image_reader=_image_reader_health(settings),
        image_triage=ImageTriageHealth(status=triage.status, detail=triage.detail, model=triage.model),
        tools=get_registry().names(),
    )


# Bundled frontend. Mounted last, so every /api route above wins over this
# catch-all; html=True serves index.html at "/" and 404.html for unknown paths.
if (_dist := _frontend_dist()) is not None:
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
