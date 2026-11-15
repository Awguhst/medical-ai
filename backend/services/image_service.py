"""Temporary, session-scoped storage for uploaded images, PDF documents and annotated images.

Design points:

* Uploads are validated by decoding their *content* with Pillow; the extension
  and the browser-reported MIME type are ignored.
* Every image is re-encoded to PNG, which strips EXIF and other metadata.
* A PDF is accepted only if it parses, is not encrypted and is short. It is
  kept as uploaded, is never served back to the browser and is only ever
  forwarded to the document reader.
* Files live in a private temp directory under server-generated random names.
  No user- or model-supplied string ever becomes part of a path.
* Each image belongs to one (session, conversation) pair and is only served
  back to that session.
* Images expire after a TTL and the whole directory is removed on shutdown.
"""

from __future__ import annotations

import io
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageOps, UnidentifiedImageError
from pypdf import PdfReader

from config import Settings, get_settings
from i18n import tr
from services.safety_service import sanitize_filename

ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP", "BMP", "MPO"}  # MPO = multi-picture JPEG


class ImageValidationError(Exception):
    """Raised with a stable code. The user-facing text is looked up per interface
    language in i18n.py, under ``upload.<code>`` unless another key is given."""

    def __init__(self, code: str, key: str | None = None, **params: object):
        self.code = code
        self.key = key or f"upload.{code}"
        self.params = params
        super().__init__(self.key)

    def message(self, language: str) -> str:
        return tr(language, self.key, **self.params)


@dataclass
class ImageRecord:
    image_id: str
    session_id: str
    conversation_id: str
    kind: Literal["upload", "annotated"]
    path: Path
    filename: str
    width: int
    height: int
    size_bytes: int
    created_at: float = field(default_factory=time.time)
    source_image_id: str | None = None
    media: Literal["image", "pdf"] = "image"
    pages: int = 1
    # Local vision-transformer triage: what kind of picture this is
    # (xray / scan / document / photo / unknown) and how sure the model was.
    content: str = "unknown"
    content_confidence: float = 0.0


@dataclass
class ToolResultRecord:
    result_id: str
    session_id: str
    conversation_id: str
    tool_name: str
    payload: dict[str, Any]
    created_at: float = field(default_factory=time.time)


class ImageStore:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._dir = Path(tempfile.mkdtemp(prefix="medai_images_")).resolve()
        self._images: dict[str, ImageRecord] = {}
        self._results: dict[str, ToolResultRecord] = {}
        self._lock = threading.Lock()
        # Hard stop for decompression bombs, on top of our own dimension checks.
        Image.MAX_IMAGE_PIXELS = settings.max_image_pixels * 2

    # -- helpers -----------------------------------------------------------

    def _new_path(self, image_id: str, suffix: str = ".png") -> Path:
        path = (self._dir / f"{image_id}{suffix}").resolve()
        if path.parent != self._dir:  # defence in depth; ids are server-made
            raise RuntimeError("refusing to write outside the image directory")
        return path

    def _count_for_conversation(self, session_id: str, conversation_id: str) -> int:
        return sum(
            1
            for r in self._images.values()
            if r.session_id == session_id
            and r.conversation_id == conversation_id
            and r.kind == "upload"
        )

    # -- uploads -----------------------------------------------------------

    def store_upload(
        self, data: bytes, filename: str | None, session_id: str, conversation_id: str
    ) -> ImageRecord:
        s = self._settings
        if not data:
            raise ImageValidationError("empty_file")
        if len(data) > s.max_upload_bytes:
            raise ImageValidationError("file_too_large", max_mb=s.max_upload_bytes // (1024 * 1024))

        if data.lstrip()[:5] == b"%PDF-":
            return self._store_pdf(data, filename, session_id, conversation_id)

        try:
            with Image.open(io.BytesIO(data)) as probe:
                fmt = (probe.format or "").upper()
                width, height = probe.size
                if fmt not in ALLOWED_FORMATS:
                    raise ImageValidationError("unsupported_format")
                if (
                    width > s.max_image_side
                    or height > s.max_image_side
                    or width * height > s.max_image_pixels
                ):
                    raise ImageValidationError("image_too_large", max_side=s.max_image_side)
                if width < s.min_image_side or height < s.min_image_side:
                    raise ImageValidationError("image_too_small", min_side=s.min_image_side)
                probe.load()  # full decode: catches truncated / corrupt files
                img = ImageOps.exif_transpose(probe)
                img = img.convert("L" if img.mode in {"L", "LA", "1", "I", "I;16", "F"} else "RGB")
        except ImageValidationError:
            raise
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
            raise ImageValidationError("not_an_image") from None

        with self._lock:
            if self._count_for_conversation(session_id, conversation_id) >= s.max_images_per_conversation:
                raise ImageValidationError("too_many_images")
            image_id = "img_" + secrets.token_urlsafe(18)
            path = self._new_path(image_id)

        img.save(path, format="PNG")
        record = ImageRecord(
            image_id=image_id,
            session_id=session_id,
            conversation_id=conversation_id,
            kind="upload",
            path=path,
            filename=sanitize_filename(filename),
            width=img.width,
            height=img.height,
            size_bytes=path.stat().st_size,
        )
        with self._lock:
            self._images[image_id] = record
        return record

    def _store_pdf(
        self, data: bytes, filename: str | None, session_id: str, conversation_id: str
    ) -> ImageRecord:
        s = self._settings
        try:
            reader = PdfReader(io.BytesIO(data), strict=False)
            encrypted = reader.is_encrypted
            pages = 0 if encrypted else len(reader.pages)
        except Exception:  # noqa: BLE001 - pypdf raises many types for malformed files
            raise ImageValidationError("not_a_pdf") from None
        if encrypted:
            raise ImageValidationError("pdf_encrypted")
        if pages < 1:
            raise ImageValidationError("not_a_pdf", key="upload.pdf_no_pages")
        if pages > s.max_pdf_pages:
            raise ImageValidationError("pdf_too_long", pages=pages, max_pages=s.max_pdf_pages)

        with self._lock:
            if self._count_for_conversation(session_id, conversation_id) >= s.max_images_per_conversation:
                raise ImageValidationError("too_many_images", key="upload.too_many_files")
            image_id = "doc_" + secrets.token_urlsafe(18)
            path = self._new_path(image_id, ".pdf")

        path.write_bytes(data)
        record = ImageRecord(
            image_id=image_id,
            session_id=session_id,
            conversation_id=conversation_id,
            kind="upload",
            path=path,
            filename=sanitize_filename(filename),
            width=0,
            height=0,
            size_bytes=len(data),
            media="pdf",
            pages=pages,
            content="document",
            content_confidence=1.0,
        )
        with self._lock:
            self._images[image_id] = record
        return record

    def store_annotated(
        self, image: Image.Image, source: ImageRecord
    ) -> ImageRecord:
        image_id = "res_" + secrets.token_urlsafe(18)
        path = self._new_path(image_id)
        image.convert("RGB").save(path, format="PNG")
        record = ImageRecord(
            image_id=image_id,
            session_id=source.session_id,
            conversation_id=source.conversation_id,
            kind="annotated",
            path=path,
            filename=f"annotated_{source.filename}",
            width=image.width,
            height=image.height,
            size_bytes=path.stat().st_size,
            source_image_id=source.image_id,
        )
        with self._lock:
            self._images[image_id] = record
        return record

    def set_content(self, image_id: str, label: str, confidence: float) -> None:
        """Record the triage label for an upload (after classification)."""
        with self._lock:
            record = self._images.get(image_id)
            if record is not None:
                record.content = label
                record.content_confidence = confidence

    # -- lookups -----------------------------------------------------------

    def get(
        self,
        image_id: str,
        session_id: str,
        conversation_id: str | None = None,
        kind: str | None = None,
    ) -> ImageRecord | None:
        """Return the record only if it belongs to the caller's session
        (and conversation, when given) and has not expired."""
        with self._lock:
            record = self._images.get(image_id)
        if record is None:
            return None
        if not secrets.compare_digest(record.session_id, session_id):
            return None
        if conversation_id is not None and record.conversation_id != conversation_id:
            return None
        if kind is not None and record.kind != kind:
            return None
        if time.time() - record.created_at > self._settings.image_ttl_seconds:
            return None
        if not record.path.is_file():
            return None
        return record

    # -- tool results ------------------------------------------------------

    def store_tool_result(
        self, session_id: str, conversation_id: str, tool_name: str, payload: dict[str, Any]
    ) -> str:
        result_id = "tr_" + secrets.token_urlsafe(18)
        with self._lock:
            self._results[result_id] = ToolResultRecord(
                result_id, session_id, conversation_id, tool_name, payload
            )
        return result_id

    def get_tool_result(
        self, result_id: str, session_id: str, conversation_id: str
    ) -> ToolResultRecord | None:
        with self._lock:
            record = self._results.get(result_id)
        if (
            record is None
            or not secrets.compare_digest(record.session_id, session_id)
            or record.conversation_id != conversation_id
            or time.time() - record.created_at > self._settings.image_ttl_seconds
        ):
            return None
        return record

    # -- deletion ----------------------------------------------------------

    def _remove(self, predicate) -> int:
        with self._lock:
            doomed = [r for r in self._images.values() if predicate(r)]
            for r in doomed:
                del self._images[r.image_id]
            for rid in [rid for rid, r in self._results.items() if predicate(r)]:
                del self._results[rid]
        for r in doomed:
            try:
                r.path.unlink(missing_ok=True)
            except OSError:
                pass
        return len(doomed)

    def delete_conversation(self, session_id: str, conversation_id: str) -> int:
        return self._remove(
            lambda r: r.session_id == session_id and r.conversation_id == conversation_id
        )

    def delete_session(self, session_id: str) -> int:
        return self._remove(lambda r: r.session_id == session_id)

    def cleanup_expired(self) -> int:
        cutoff = time.time() - self._settings.image_ttl_seconds
        return self._remove(lambda r: r.created_at < cutoff)

    def shutdown(self) -> None:
        with self._lock:
            self._images.clear()
            self._results.clear()
        shutil.rmtree(self._dir, ignore_errors=True)


_store: ImageStore | None = None


def get_image_store() -> ImageStore:
    global _store
    if _store is None:
        _store = ImageStore(get_settings())
    return _store
