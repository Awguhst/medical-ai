"""Application configuration, loaded once from the environment / .env file.

Secrets (the Anthropic API key) are read here and never leave the backend.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

# The .env file lives in the project root; a backend/.env is honoured as well.
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


def _resolve_path(raw: str) -> Path | None:
    raw = raw.strip()
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        # Relative paths are resolved against the project root, so that
        # YOLO_WEIGHTS_PATH=./models/medical_yolo.pt works from any cwd.
        path = PROJECT_ROOT / path
    return path.resolve()


@dataclass(frozen=True)
class Settings:
    # --- Claude ---------------------------------------------------------
    anthropic_api_key: str = field(repr=False, default="")
    anthropic_model: str = "claude-opus-5-5"
    anthropic_max_tokens: int = 16000
    anthropic_effort: str = ""  # empty = model default
    anthropic_refusal_fallback: bool = True
    claude_timeout_seconds: float = 180.0
    max_tool_iterations: int = 4

    # --- YOLO -----------------------------------------------------------
    yolo_weights_path: Path | None = None
    yolo_conf_threshold: float = 0.25
    yolo_image_size: int = 640
    yolo_allow_demo_mode: bool = True
    tool_timeout_seconds: float = 60.0

    # --- Image triage (local CLIP vision transformer) ---------------------
    image_triage_enabled: bool = True
    image_triage_model: str = "openai/clip-vit-base-patch32"
    image_triage_min_confidence: float = 0.5
    image_triage_timeout_seconds: float = 20.0
    image_triage_cache_dir: Path | None = None

    # --- Doctor search (superdoc.bg) ------------------------------------
    superdoc_enabled: bool = True
    superdoc_timeout_seconds: float = 12.0

    # --- Medication reference (framar.bg) --------------------------------
    framar_enabled: bool = True
    framar_timeout_seconds: float = 12.0

    # --- Document reader (Claude vision) --------------------------------
    document_reader_enabled: bool = True
    document_max_tokens: int = 8000
    max_pdf_pages: int = 10

    # --- Uploads --------------------------------------------------------
    max_upload_bytes: int = 10 * 1024 * 1024
    max_image_side: int = 6000
    max_image_pixels: int = 24_000_000
    min_image_side: int = 64
    image_ttl_seconds: int = 60 * 60
    max_images_per_conversation: int = 12

    # --- Chat limits ----------------------------------------------------
    max_message_chars: int = 6000
    max_history_messages: int = 60
    max_attachments_per_message: int = 4

    # --- HTTP -----------------------------------------------------------
    frontend_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")

    @property
    def claude_configured(self) -> bool:
        key = self.anthropic_api_key
        return bool(key) and key != "your_api_key_here"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    model = os.getenv("ANTHROPIC_MODEL", "").strip()
    if not model or model == "your_supported_claude_model":
        model = "claude-opus-5-5"

    origins = tuple(
        o.strip().rstrip("/")
        for o in os.getenv(
            "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if o.strip()
    )

    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        anthropic_model=model,
        anthropic_max_tokens=_int("ANTHROPIC_MAX_TOKENS", 16000),
        anthropic_effort=os.getenv("ANTHROPIC_EFFORT", "").strip().lower(),
        anthropic_refusal_fallback=_bool("ANTHROPIC_REFUSAL_FALLBACK", True),
        claude_timeout_seconds=_float("CLAUDE_TIMEOUT_SECONDS", 180.0),
        max_tool_iterations=max(1, _int("MAX_TOOL_ITERATIONS", 4)),
        yolo_weights_path=_resolve_path(os.getenv("YOLO_WEIGHTS_PATH", "")),
        yolo_conf_threshold=_float("YOLO_CONF_THRESHOLD", 0.25),
        yolo_image_size=_int("YOLO_IMAGE_SIZE", 640),
        yolo_allow_demo_mode=_bool("YOLO_ALLOW_DEMO_MODE", True),
        tool_timeout_seconds=_float("TOOL_TIMEOUT_SECONDS", 60.0),
        image_triage_enabled=_bool("IMAGE_TRIAGE_ENABLED", True),
        image_triage_model=os.getenv("IMAGE_TRIAGE_MODEL", "").strip() or "openai/clip-vit-base-patch32",
        image_triage_min_confidence=_float("IMAGE_TRIAGE_MIN_CONFIDENCE", 0.5),
        image_triage_timeout_seconds=_float("IMAGE_TRIAGE_TIMEOUT_SECONDS", 20.0),
        image_triage_cache_dir=_resolve_path(os.getenv("IMAGE_TRIAGE_CACHE_DIR", "./models/triage")),
        superdoc_enabled=_bool("SUPERDOC_ENABLED", True),
        superdoc_timeout_seconds=_float("SUPERDOC_TIMEOUT_SECONDS", 12.0),
        framar_enabled=_bool("FRAMAR_ENABLED", True),
        framar_timeout_seconds=_float("FRAMAR_TIMEOUT_SECONDS", 12.0),
        document_reader_enabled=_bool("DOCUMENT_READER_ENABLED", True),
        document_max_tokens=_int("DOCUMENT_MAX_TOKENS", 8000),
        max_pdf_pages=max(1, _int("MAX_PDF_PAGES", 10)),
        max_upload_bytes=_int("MAX_UPLOAD_MB", 10) * 1024 * 1024,
        image_ttl_seconds=_int("IMAGE_TTL_MINUTES", 60) * 60,
        frontend_origins=origins,
    )
