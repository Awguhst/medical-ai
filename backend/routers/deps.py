"""Shared request dependencies."""

from __future__ import annotations

import re

from fastapi import Header, HTTPException

from models.schemas import ID_PATTERN

_ID_RE = re.compile(ID_PATTERN)


def require_session(x_session_id: str | None = Header(default=None)) -> str:
    """The browser generates a random session id (kept in sessionStorage) and
    sends it with every request. Images and tool results are bound to it."""
    if not x_session_id or not _ID_RE.match(x_session_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_session", "message": "Липсва или е невалидна сесия."},
        )
    return x_session_id


def validate_id(value: str, what: str) -> str:
    if not _ID_RE.match(value or ""):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_id", "message": f"Невалиден идентификатор ({what})."},
        )
    return value
