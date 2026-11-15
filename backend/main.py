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

from dotenv import dotenv_values

from config import BACKEND_DIR, PROJECT_ROOT, get_settings
from models.schemas import HealthResponse, ImageTriageHealth, YoloHealth
from routers import chat, uploads
from services.image_service import get_image_store
from services.image_triage_service import get_image_triage_service
from services.tool_registry import get_registry
from services.yolo_service import get_yolo_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# Request/response bodies are never logged; keep the HTTP client quiet as well.
for noisy in ("httpx", "httpx2", "httpcore", "httpcore2", "anthropic"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
logger = logging.getLogger("medai")


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


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    store = get_image_store()
    yolo = get_yolo_service().status()
    triage = get_image_triage_service()
    logger.info(
        "MedAI backend starting | claude_configured=%s key_source=%s model=%s | yolo=%s | image_triage=%s",
        settings.claude_configured, _claude_key_source(), settings.anthropic_model, yolo.status,
        triage.status().status,
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
    allow_headers=["Content-Type", "X-Session-Id"],
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
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Field locations only — never echo submitted values back or into logs.
    fields = sorted({".".join(str(p) for p in err.get("loc", ())[1:]) for err in exc.errors()})
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_request",
                "message": "Невалидна заявка.",
                "fields": fields,
            }
        },
    )


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    yolo = get_yolo_service().status()
    triage = get_image_triage_service().status()
    return HealthResponse(
        status="ok",
        claude_configured=settings.claude_configured,
        claude_key_source=_claude_key_source(),  # type: ignore[arg-type]
        claude_model=settings.anthropic_model,
        yolo=YoloHealth(
            status=yolo.status,  # type: ignore[arg-type]
            detail=yolo.detail,
            demo_mode_allowed=settings.yolo_allow_demo_mode,
            classes=yolo.classes,
        ),
        image_triage=ImageTriageHealth(status=triage.status, detail=triage.detail, model=triage.model),
        tools=get_registry().names(),
    )
