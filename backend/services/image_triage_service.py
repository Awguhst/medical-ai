"""Local image triage: what kind of picture did the user upload?

A zero-shot CLIP vision transformer (ViT-B/32 by default) runs on the server
and labels every uploaded image as one of:

* ``xray``      a radiograph (chest, limb, dental ...): the analyze_xray input
* ``scan``      another medical image (CT, MRI, ultrasound, mammography)
* ``document``  paper with text: a report, lab results, a prescription
* ``photo``     an ordinary photograph (skin, a body part, a room)
* ``unknown``   no label reached the confidence threshold, or triage is off

The label is stored on the upload record, sent to Claude as attachment
metadata, used to force the matching tool on the first model step, and lets
analyze_xray refuse photos and documents without running YOLO.

The picture never leaves the server. The model is downloaded once from the
Hugging Face hub (safetensors only; no pickled checkpoints) and runs on the
CPU. Everything here degrades to ``unknown``: a missing library, a failed
download or a broken image never blocks an upload.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from PIL import Image

from config import Settings, get_settings

logger = logging.getLogger("medai.triage")

TriageLabel = Literal["xray", "scan", "document", "photo", "unknown"]

# Each category is described by several prompts; their probabilities are
# summed, which is more robust than a single prompt per class.
_PROMPTS: dict[str, list[str]] = {
    "xray": [
        "a chest X-ray radiograph",
        "an X-ray image of bones",
        "a medical radiograph on a dark background",
        "a dental panoramic X-ray",
        "an X-ray of a hand, foot, knee or spine",
    ],
    "scan": [
        "a CT scan slice",
        "an MRI scan of the brain or body",
        "an ultrasound image",
        "a mammography image",
    ],
    "document": [
        "a photo of a printed medical document",
        "a scanned page with printed text and tables",
        "a laboratory results sheet",
        "a handwritten prescription on paper",
        "a screenshot of text",
    ],
    "photo": [
        "a photo of human skin with a rash or a mole",
        "a close-up photo of a body part taken with a phone",
        "a photograph of a person",
        "a photo of an everyday scene or object",
        "a colour photograph of a landscape or a room",
        "an abstract wallpaper or digital artwork",
    ],
}

# Radiographs, CT, MRI and ultrasound are greyscale. An image with more
# colour than this (fraction of clearly saturated pixels) cannot be one, so
# those two labels are vetoed whatever the vision model preferred.
_MAX_COLOUR_FRACTION = 0.20

# After a failed load (for example no internet on first start), try again
# this much later instead of on every upload.
_RETRY_AFTER_SECONDS = 600.0


@dataclass(frozen=True)
class TriageResult:
    label: TriageLabel
    confidence: float
    scores: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class TriageStatus:
    status: Literal["ready", "loading", "disabled", "not_installed", "error"]
    detail: str
    model: str


UNKNOWN = TriageResult("unknown", 0.0)


def _colour_fraction(rgb: Image.Image) -> float:
    """Share of pixels that are clearly coloured (same test as the YOLO guard)."""
    import numpy as np

    hsv = rgb.resize((128, 128)).convert("HSV")
    saturation = np.asarray(hsv.getchannel("S"))
    value = np.asarray(hsv.getchannel("V"))
    return float(((saturation > 70) & (value > 40)).mean())


class ImageTriageService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._model: Any = None
        self._processor: Any = None
        self._text_inputs: Any = None  # tokenised prompts, reused for every image
        self._labels: list[str] = []  # category of each flattened prompt
        self._retry_at = 0.0
        name = settings.image_triage_model
        if settings.image_triage_enabled:
            self._state = TriageStatus("loading", "The model loads at start-up or on first use.", name)
        else:
            self._state = TriageStatus(
                "disabled", "Image triage is disabled (IMAGE_TRIAGE_ENABLED=false).", name
            )

    @property
    def enabled(self) -> bool:
        return self._settings.image_triage_enabled

    def status(self) -> TriageStatus:
        return self._state

    def warm_up(self) -> TriageStatus:
        """Load the model now (blocking); called in a background thread at start-up."""
        if not self.enabled:
            return self._state
        with self._lock:
            self._load_locked()
        return self._state

    # -- loading -----------------------------------------------------------

    def _load_locked(self) -> bool:
        if self._model is not None:
            return True
        if self._state.status in {"error", "not_installed"} and time.time() < self._retry_at:
            return False

        name = self._settings.image_triage_model
        try:
            import torch
            from transformers import CLIPModel, CLIPProcessor
        except ImportError:
            self._state = TriageStatus(
                "not_installed",
                "The transformers library is not installed (pip install transformers).",
                name,
            )
            self._retry_at = time.time() + _RETRY_AFTER_SECONDS
            return False

        try:
            kwargs: dict[str, Any] = {}
            cache_dir = self._settings.image_triage_cache_dir
            if cache_dir is not None:
                cache_dir.mkdir(parents=True, exist_ok=True)
                kwargs["cache_dir"] = str(cache_dir)
            model = CLIPModel.from_pretrained(name, use_safetensors=True, **kwargs)
            processor = CLIPProcessor.from_pretrained(name, **kwargs)
            model.eval()
            prompts = [prompt for group in _PROMPTS.values() for prompt in group]
            labels = [label for label, group in _PROMPTS.items() for _ in group]
            # Tokenise once; the full forward pass below scores image against
            # text and is stable across transformers 4.x and 5.x, unlike the
            # get_*_features helpers, whose return type changed in 5.x.
            text_inputs = dict(processor(text=prompts, return_tensors="pt", padding=True))
            with torch.inference_mode():
                probe = Image.new("RGB", (32, 32), (128, 128, 128))
                pixel_values = processor(images=probe, return_tensors="pt")["pixel_values"]
                model(**text_inputs, pixel_values=pixel_values).logits_per_image
        except Exception as exc:  # noqa: BLE001 - any failure just disables triage
            logger.error("image triage model failed to load: %s", type(exc).__name__)
            self._state = TriageStatus(
                "error",
                f"The model could not be loaded ({type(exc).__name__}). The first start needs "
                "an internet connection to download it.",
                name,
            )
            self._retry_at = time.time() + _RETRY_AFTER_SECONDS
            return False

        self._model = model
        self._processor = processor
        self._text_inputs = text_inputs
        self._labels = labels
        self._state = TriageStatus("ready", "Local CLIP vision transformer, running on the CPU.", name)
        logger.info("image triage model ready: %s", name)
        return True

    # -- classification ----------------------------------------------------

    def classify(self, path: Path) -> TriageResult:
        """Label one stored image. Never raises; returns ``unknown`` on any problem."""
        if not self.enabled:
            return UNKNOWN
        with self._lock:
            if not self._load_locked():
                return UNKNOWN
            try:
                import torch

                with Image.open(path) as img:
                    rgb = img.convert("RGB")
                colour = _colour_fraction(rgb)
                with torch.inference_mode():
                    pixel_values = self._processor(images=rgb, return_tensors="pt")["pixel_values"]
                    output = self._model(**self._text_inputs, pixel_values=pixel_values)
                    # One image against every prompt: shape (1, n_prompts).
                    probs = output.logits_per_image.softmax(dim=-1)[0].tolist()
            except Exception as exc:  # noqa: BLE001
                logger.warning("image triage failed: %s", type(exc).__name__)
                return UNKNOWN

        scores: dict[str, float] = {label: 0.0 for label in _PROMPTS}
        for label, prob in zip(self._labels, probs):
            scores[label] += float(prob)
        if colour > _MAX_COLOUR_FRACTION:
            # A coloured picture is a photo or a page, never a radiograph or a
            # scan; keep the vision model's preference between those two.
            scores["xray"] = 0.0
            scores["scan"] = 0.0
            total = sum(scores.values()) or 1.0
            scores = {label: value / total for label, value in scores.items()}
        best = max(scores, key=lambda label: scores[label])
        confidence = scores[best]
        label: TriageLabel = (
            best if confidence >= self._settings.image_triage_min_confidence else "unknown"  # type: ignore[assignment]
        )
        detail = {k: round(v, 4) for k, v in scores.items()}
        detail["colour_fraction"] = round(colour, 3)
        return TriageResult(label, round(confidence, 4), detail)


_service: ImageTriageService | None = None


def get_image_triage_service() -> ImageTriageService:
    global _service
    if _service is None:
        _service = ImageTriageService(get_settings())
    return _service
