"""Input hygiene and safety helpers.

Nothing here replaces Claude's judgement; these are deterministic guard rails
that run on the server regardless of what the model does:

* user-supplied strings (text, filenames) are cleaned before they are used;
* obvious emergency wording triggers an immediate 112 banner in the UI, so the
  user sees it even before the model starts answering;
* log helpers make sure medical content never ends up in server logs.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_FILENAME_SAFE = re.compile(r"[^\w\-. ()]", re.UNICODE)

# Bulgarian (and a few English) phrases that suggest a possible emergency.
# Deliberately broad: a false positive only shows a "call 112" reminder.
_EMERGENCY_PATTERNS = [
    r"силн\w* болк\w* в гърд",
    r"болк\w* в гърд\w*",
    r"стяга\w* в гърд",
    r"не мога да дишам",
    r"не мог\w* да си поем\w* (дъх|въздух)",
    r"(тежък|силен|остър) задух",
    r"задушава[мш]",
    r"посиня\w*",
    r"инсулт",
    r"инфаркт",
    r"изкрив\w* (на )?(лице|уста)",
    r"увисна\w* (лице|уста|ъгъл)",
    r"внезапн\w* (слабост|изтръпване|загуба на (зрение|говор|съзнание))",
    r"не мог\w* да говор",
    r"загуб\w* (на )?съзнание",
    r"припадн\w*",
    r"гърч\w*",
    r"обилн\w* кърв\w*",
    r"кърв\w* не спира",
    r"повръща\w* кръв",
    r"изкашля\w* кръв|кашля\w* кръв",
    r"анафила\w*",
    r"подува\w* (на )?(език|гърло)",
    r"самоуби\w*",
    r"да се самоубия|да сложа край на живота",
    r"предозира\w*",
    r"отров\w*",
    r"\bchest pain\b",
    r"\bcan'?t breathe\b",
    r"\bstroke\b",
    r"\bsuicid\w*",
]
_EMERGENCY_RE = re.compile("|".join(f"(?:{p})" for p in _EMERGENCY_PATTERNS), re.IGNORECASE)


def clean_text(text: str, max_chars: int) -> str:
    """Normalise user text: drop control characters, trim, cap the length."""
    text = unicodedata.normalize("NFC", text or "")
    text = _CONTROL_CHARS.sub("", text)
    return text.strip()[:max_chars]


def sanitize_filename(name: str | None) -> str:
    """Return a display-only filename. It is never used to build a path."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = _CONTROL_CHARS.sub("", name)
    name = _FILENAME_SAFE.sub("_", name).strip(" .")
    if len(name) > 80:
        stem, dot, ext = name.rpartition(".")
        name = (stem[:70] + dot + ext[:8]) if dot else name[:80]
    return name or "image"


def detect_emergency(text: str) -> bool:
    return bool(_EMERGENCY_RE.search(text or ""))


def log_ref(identifier: str) -> str:
    """Short, non-reversible reference for logs (never log raw ids/content)."""
    return hashlib.sha256(identifier.encode("utf-8", "ignore")).hexdigest()[:10]
