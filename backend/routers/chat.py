"""Chat endpoint: streams Claude's answer and tool events as Server-Sent Events."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from config import get_settings
from i18n import Language, tr
from models.schemas import ChatRequest
from routers.deps import get_language, require_session
from services.claude_service import stream_chat
from services.safety_service import clean_text

logger = logging.getLogger("medai.chat")
router = APIRouter(prefix="/api", tags=["chat"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(
    request: ChatRequest,
    session_id: str = Depends(require_session),
    language: Language = Depends(get_language),
) -> StreamingResponse:
    settings = get_settings()

    if not request.consent:
        raise HTTPException(
            status_code=403,
            detail={"code": "consent_required", "message": tr(language, "consent_required")},
        )
    if not settings.claude_configured:
        raise HTTPException(
            status_code=503,
            detail={"code": "claude_not_configured", "message": tr(language, "claude_not_configured")},
        )

    text = clean_text(request.message.text, settings.max_message_chars + 1)
    if len(text) > settings.max_message_chars:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "message_too_long",
                "message": tr(language, "message_too_long", max_chars=settings.max_message_chars),
            },
        )
    if not text and not request.message.attachment_ids:
        raise HTTPException(
            status_code=422,
            detail={"code": "empty_message", "message": tr(language, "empty_message")},
        )
    if len(request.message.attachment_ids) > settings.max_attachments_per_message:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "too_many_attachments",
                "message": tr(
                    language, "too_many_attachments", max_files=settings.max_attachments_per_message
                ),
            },
        )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in stream_chat(request, session_id, language):
                yield _sse(event)
        except Exception as exc:  # noqa: BLE001 - last line of defence for the stream
            logger.error("unhandled chat error: %s", type(exc).__name__)
            yield _sse(
                {"type": "error", "code": "internal_error", "message": tr(language, "internal_error")}
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no"},
    )
