"""Shared request dependencies."""

from __future__ import annotations

import re
from typing import Literal

from fastapi import Depends, Header, HTTPException

from i18n import Language, parse_language, tr
from models.schemas import ID_PATTERN

_ID_RE = re.compile(ID_PATTERN)


def get_language(accept_language: str | None = Header(default=None)) -> Language:
    """The language the browser is showing (``bg`` or ``en``), from the standard
    Accept-Language header. It selects the language of every message the API
    returns for the user and of the assistant's replies. Default: Bulgarian."""
    return parse_language(accept_language)


def require_session(
    x_session_id: str | None = Header(default=None), language: Language = Depends(get_language)
) -> str:
    """The browser generates a random session id (kept in sessionStorage) and
    sends it with every request. Images and tool results are bound to it."""
    if not x_session_id or not _ID_RE.match(x_session_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_session", "message": tr(language, "invalid_session")},
        )
    return x_session_id


def validate_id(value: str, what: Literal["conversation", "image"], language: Language) -> str:
    if not _ID_RE.match(value or ""):
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_id", "message": tr(language, f"invalid_id.{what}")},
        )
    return value
