"""Download the image triage model into IMAGE_TRIAGE_CACHE_DIR ahead of time.

The Dockerfile runs this while building, so the image carries the CLIP model
and a fresh container never downloads it. It is also handy locally, to warm
the cache before a first start:

    cd backend && python prefetch_models.py

Exits with status 1 if the model did not load, so a broken download fails the
build instead of surfacing as "loading" forever at runtime.
"""

from __future__ import annotations

import sys

from config import get_settings
from services.image_triage_service import ImageTriageService


def main() -> int:
    settings = get_settings()
    if not settings.image_triage_enabled:
        print("image triage is disabled (IMAGE_TRIAGE_ENABLED=false); nothing to download")
        return 0
    status = ImageTriageService(settings).warm_up()
    print(f"{status.status}: {status.detail} ({status.model})")
    return 0 if status.status == "ready" else 1


if __name__ == "__main__":
    sys.exit(main())
