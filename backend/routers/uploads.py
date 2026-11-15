"""Image upload, retrieval and deletion endpoints."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from config import get_settings
from models.schemas import UploadResponse
from routers.deps import require_session, validate_id
from services.image_service import ImageValidationError, get_image_store
from services.image_triage_service import UNKNOWN, get_image_triage_service
from services.safety_service import log_ref

logger = logging.getLogger("medai.uploads")
router = APIRouter(prefix="/api", tags=["images"])


@router.post("/upload", response_model=UploadResponse)
async def upload_image(
    file: UploadFile = File(...),
    conversation_id: str = Form(...),
    session_id: str = Depends(require_session),
) -> UploadResponse:
    settings = get_settings()
    validate_id(conversation_id, "разговор")

    # Read at most limit+1 bytes so an oversized body is never fully buffered.
    data = await file.read(settings.max_upload_bytes + 1)
    await file.close()

    store = get_image_store()
    try:
        record = await asyncio.to_thread(
            store.store_upload, data, file.filename, session_id, conversation_id
        )
    except ImageValidationError as exc:
        status = 413 if exc.code == "file_too_large" else 400
        raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message})

    # Local vision-transformer triage: label the picture (xray / scan / document /
    # photo) so the assistant knows which tool to call without asking. The
    # image stays on this server. Any problem leaves the label "unknown".
    triage = get_image_triage_service()
    if record.media == "image" and triage.enabled:
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(triage.classify, record.path),
                timeout=settings.image_triage_timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("image triage timed out conv=%s", log_ref(conversation_id))
            result = UNKNOWN
        store.set_content(record.image_id, result.label, result.confidence)

    logger.info(
        "upload stored %s %dx%d triage=%s(%.2f) conv=%s",
        record.media, record.width, record.height, record.content, record.content_confidence,
        log_ref(conversation_id),
    )
    return UploadResponse(
        image_id=record.image_id,
        filename=record.filename,
        width=record.width,
        height=record.height,
        size_bytes=record.size_bytes,
        media_type=record.media,
        pages=record.pages,
        content=record.content,  # type: ignore[arg-type]
        content_confidence=round(record.content_confidence, 2),
        expires_in_seconds=settings.image_ttl_seconds,
    )


@router.get("/images/{image_id}")
async def get_image(image_id: str, session_id: str = Depends(require_session)) -> FileResponse:
    validate_id(image_id, "изображение")
    record = get_image_store().get(image_id, session_id)
    if record is None or record.media != "image":
        # Same answer for "unknown", "expired", "belongs to someone else" and "is a PDF".
        raise HTTPException(
            status_code=404,
            detail={"code": "image_not_found", "message": "Изображението не е налично."},
        )
    return FileResponse(
        record.path,
        media_type="image/png",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str, session_id: str = Depends(require_session)
) -> dict:
    validate_id(conversation_id, "разговор")
    removed = get_image_store().delete_conversation(session_id, conversation_id)
    return {"status": "deleted", "removed_images": removed}


@router.delete("/session")
async def delete_session(session_id: str = Depends(require_session)) -> dict:
    removed = get_image_store().delete_session(session_id)
    return {"status": "deleted", "removed_images": removed}
