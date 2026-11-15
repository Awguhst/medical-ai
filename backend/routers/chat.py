"""Chat endpoint: streams Claude's answer and tool events as Server-Sent Events."""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from config import get_settings
from models.schemas import ChatRequest
from routers.deps import require_session
from services.claude_service import stream_chat
from services.safety_service import clean_text

logger = logging.getLogger("medai.chat")
router = APIRouter(prefix="/api", tags=["chat"])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(request: ChatRequest, session_id: str = Depends(require_session)) -> StreamingResponse:
    settings = get_settings()

    if not request.consent:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "consent_required",
                "message": "Необходимо е съгласие, преди съобщенията да бъдат изпратени към Claude API.",
            },
        )
    if not settings.claude_configured:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "claude_not_configured",
                "message": (
                    "Claude API не е конфигуриран. Задайте ANTHROPIC_API_KEY във файла .env "
                    "на сървъра и го рестартирайте."
                ),
            },
        )

    text = clean_text(request.message.text, settings.max_message_chars + 1)
    if len(text) > settings.max_message_chars:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "message_too_long",
                "message": f"Съобщението е твърде дълго (макс. {settings.max_message_chars} знака).",
            },
        )
    if not text and not request.message.attachment_ids:
        raise HTTPException(
            status_code=422,
            detail={"code": "empty_message", "message": "Съобщението е празно."},
        )
    if len(request.message.attachment_ids) > settings.max_attachments_per_message:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "too_many_attachments",
                "message": f"Най-много {settings.max_attachments_per_message} изображения на съобщение.",
            },
        )

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for event in stream_chat(request, session_id):
                yield _sse(event)
        except Exception as exc:  # noqa: BLE001 - last line of defence for the stream
            logger.error("unhandled chat error: %s", type(exc).__name__)
            yield _sse(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": "Възникна неочаквана грешка на сървъра.",
                }
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no"},
    )
