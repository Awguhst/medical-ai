"""Local YOLO inference for chest X-ray images.

Honesty rules enforced here, in code, not just in the prompt:

* Inference only runs with custom weights configured via YOLO_WEIGHTS_PATH.
* A general-purpose model (COCO / everyday objects) is rejected as
  incompatible — it is never presented as a medical model.
* Without weights the result is `model_not_configured`. The simulated demo
  mode must be explicitly requested and every simulated result is labelled
  as such in the data, in the annotated image and in the UI.
* An image that does not look like a radiograph is reported as
  `unsupported_image` instead of being pushed through the model.
"""

from __future__ import annotations

import hashlib
import logging
import random
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import Settings, get_settings

logger = logging.getLogger("medai.yolo")

DISCLAIMER = "Experimental model output, not a medical diagnosis."
SIMULATED_DISCLAIMER = (
    "SIMULATED DEMO DATA for user-interface testing only. No model analysed "
    "this image. The boxes, labels and scores are random placeholders and "
    "carry no medical meaning whatsoever."
)

# If a model's class list overlaps with these, it is an everyday-object model.
_GENERIC_CLASS_MARKERS = {
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "dog", "cat", "horse", "chair", "couch",
    "bottle", "cup", "laptop", "cell phone", "tv", "book", "pizza", "banana",
}

_MAX_DETECTIONS = 50


@dataclass
class YoloStatus:
    status: str  # ready | not_configured | weights_missing | incompatible | error
    detail: str
    classes: list[str]


@dataclass
class AnalysisResult:
    payload: dict[str, Any]  # structured result (without ids) for the tool layer
    annotated: Image.Image | None


def _load_font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "DejaVuSans.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


class YoloService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._classes: list[str] = []
        self._load_error: YoloStatus | None = None
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()

    # -- model loading -----------------------------------------------------

    def _weights_state(self) -> YoloStatus | None:
        """Cheap, load-free check. None means 'weights file is present'."""
        path = self._settings.yolo_weights_path
        if path is None:
            return YoloStatus(
                "not_configured", "YOLO_WEIGHTS_PATH is not set.", []
            )
        if not path.is_file():
            return YoloStatus(
                "weights_missing",
                f"No weights file found at the configured path ({path.name}).",
                [],
            )
        return None

    def _ensure_model(self) -> YoloStatus:
        missing = self._weights_state()
        if missing is not None:
            return missing
        with self._load_lock:
            if self._model is not None:
                return YoloStatus("ready", "Medical YOLO weights loaded.", self._classes)
            if self._load_error is not None:
                return self._load_error
            try:
                from ultralytics import YOLO  # heavy import, done lazily

                model = YOLO(str(self._settings.yolo_weights_path))
                names = model.names
                classes = [str(names[k]) for k in sorted(names)] if isinstance(names, dict) else [str(n) for n in names]
            except Exception as exc:  # noqa: BLE001 - surface any load failure
                logger.warning("YOLO weights failed to load: %s", type(exc).__name__)
                self._load_error = YoloStatus(
                    "error", f"The weights file could not be loaded ({type(exc).__name__}).", []
                )
                return self._load_error

            task = getattr(model, "task", "detect")
            generic = {c.lower() for c in classes} & _GENERIC_CLASS_MARKERS
            if len(generic) >= 3:
                self._load_error = YoloStatus(
                    "incompatible",
                    "The configured weights are a general-purpose object detector "
                    "(everyday-object classes), not a medical X-ray model.",
                    [],
                )
                return self._load_error
            if task != "detect":
                self._load_error = YoloStatus(
                    "incompatible",
                    f"The configured weights are a '{task}' model; a detection model is required.",
                    [],
                )
                return self._load_error

            self._model = model
            self._classes = classes
            return YoloStatus("ready", "Medical YOLO weights loaded.", classes)

    def status(self, load: bool = False) -> YoloStatus:
        """Report configuration state. With load=False the model is not loaded
        just to answer a health check."""
        if self._model is not None:
            return YoloStatus("ready", "Medical YOLO weights loaded.", self._classes)
        if self._load_error is not None:
            return self._load_error
        missing = self._weights_state()
        if missing is not None:
            return missing
        if load:
            return self._ensure_model()
        return YoloStatus("ready", "Weights file found; it is loaded on first use.", [])

    # -- image checks ------------------------------------------------------

    @staticmethod
    def _looks_like_radiograph(bgr: np.ndarray) -> tuple[bool, str]:
        """Coarse plausibility heuristic: radiographs are (near) greyscale and
        not flat. It cannot confirm an image *is* an X-ray; it only filters
        out images that clearly are not."""
        small = cv2.resize(bgr, (256, 256), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        saturated = (hsv[..., 1] > 70) & (hsv[..., 2] > 40)
        colour_fraction = float(saturated.mean())
        if colour_fraction > 0.20:
            return False, (
                "The image is predominantly coloured, whereas radiographs are "
                "greyscale. It does not appear to be an X-ray."
            )
        grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        if float(grey.std()) < 8.0:
            return False, "The image is almost uniform and contains no usable detail."
        return True, ""

    # -- public API --------------------------------------------------------

    def analyze(self, image_path: Path, seed: str, demo_requested: bool) -> AnalysisResult:
        bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if bgr is None:
            return AnalysisResult(
                {"status": "error", "message": "The stored image could not be decoded."}, None
            )
        height, width = bgr.shape[:2]

        plausible, reason = self._looks_like_radiograph(bgr)
        if not plausible:
            return AnalysisResult(
                {
                    "status": "unsupported_image",
                    "message": reason,
                    "supported_input": "Greyscale chest X-ray (radiograph) images.",
                    "detections": [],
                },
                None,
            )

        state = self._ensure_model()
        if state.status == "ready":
            return self._run_model(bgr, width, height)

        if demo_requested and self._settings.yolo_allow_demo_mode:
            return self._simulate(bgr, width, height, seed, state)

        status = "model_not_configured" if state.status in {"not_configured", "weights_missing"} else (
            "model_incompatible" if state.status == "incompatible" else "model_error"
        )
        return AnalysisResult(
            {
                "status": status,
                "message": state.detail,
                "how_to_fix": (
                    "An administrator must place custom chest X-ray YOLO weights on the "
                    "server and set YOLO_WEIGHTS_PATH (see models/README.md)."
                ),
                "demo_mode_available": self._settings.yolo_allow_demo_mode,
                "demo_mode_hint": (
                    "The user can enable 'Демо режим' in Настройки to see a simulated, "
                    "clearly labelled placeholder result for interface testing."
                    if self._settings.yolo_allow_demo_mode
                    else "Demo mode is disabled on this server."
                ),
                "detections": [],
            },
            None,
        )

    # -- real inference ----------------------------------------------------

    def _run_model(self, bgr: np.ndarray, width: int, height: int) -> AnalysisResult:
        s = self._settings
        with self._infer_lock:  # the model object is not safe for concurrent calls
            results = self._model.predict(  # type: ignore[union-attr]
                source=bgr,
                conf=s.yolo_conf_threshold,
                imgsz=s.yolo_image_size,
                max_det=_MAX_DETECTIONS,
                verbose=False,
            )
        detections: list[dict[str, Any]] = []
        if results:
            boxes = results[0].boxes
            names = results[0].names
            if boxes is not None:
                xyxy = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                classes = boxes.cls.cpu().numpy().astype(int)
                for (x1, y1, x2, y2), score, cls in zip(xyxy, confs, classes):
                    detections.append(
                        {
                            "class_name": str(names.get(int(cls), int(cls))),
                            "score": round(float(score), 4),
                            "bbox": [
                                int(max(0, round(float(x1)))),
                                int(max(0, round(float(y1)))),
                                int(min(width, round(float(x2)))),
                                int(min(height, round(float(y2)))),
                            ],
                        }
                    )
        detections.sort(key=lambda d: d["score"], reverse=True)

        annotated = self._draw(bgr, detections, simulated=False)
        payload = {
            "status": "success",
            "model_type": "medical_yolo",
            "simulated": False,
            "image_size": {"width": width, "height": height},
            "score_threshold": s.yolo_conf_threshold,
            "model_classes": self._classes,
            "detections": detections,
            "disclaimer": DISCLAIMER,
            "interpretation_notes": [
                "A score is the detector's raw confidence for a box. It is NOT the "
                "probability that the patient has a disease.",
                "The model can only output the classes listed in model_classes. "
                "Nothing can be concluded about any finding outside that list.",
                "An empty detections list means no box passed the score threshold. "
                "It does not mean the image is normal or that disease is absent.",
                "The clinical validation status of these weights is unknown to the "
                "application.",
            ],
        }
        return AnalysisResult(payload, annotated)

    # -- simulated demo ----------------------------------------------------

    def _simulate(
        self, bgr: np.ndarray, width: int, height: int, seed: str, state: YoloStatus
    ) -> AnalysisResult:
        rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:12], 16))
        detections = []
        for index in range(rng.randint(1, 2)):
            w = int(width * rng.uniform(0.16, 0.30))
            h = int(height * rng.uniform(0.16, 0.30))
            x1 = rng.randint(int(width * 0.08), max(int(width * 0.08) + 1, int(width * 0.92) - w))
            y1 = rng.randint(int(height * 0.14), max(int(height * 0.14) + 1, int(height * 0.90) - h))
            detections.append(
                {
                    "class_name": f"SIMULATED_PLACEHOLDER_{index + 1}",
                    "score": round(rng.uniform(0.30, 0.90), 2),
                    "bbox": [x1, y1, x1 + w, y1 + h],
                    "simulated": True,
                }
            )
        annotated = self._draw(bgr, detections, simulated=True)
        payload = {
            "status": "simulated_demo",
            "model_type": "simulated_demo",
            "simulated": True,
            "real_model_status": state.status,
            "real_model_detail": state.detail,
            "image_size": {"width": width, "height": height},
            "model_classes": [],
            "detections": detections,
            "disclaimer": SIMULATED_DISCLAIMER,
            "interpretation_notes": [
                "No medical model was run. These values are random placeholders.",
                "Do not interpret, explain or draw any medical conclusion from them.",
                "Tell the user clearly that this is a simulation for testing the interface.",
            ],
        }
        return AnalysisResult(payload, annotated)

    # -- drawing -----------------------------------------------------------

    @staticmethod
    def _draw(bgr: np.ndarray, detections: list[dict[str, Any]], simulated: bool) -> Image.Image:
        image = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(image, "RGBA")
        width, height = image.size
        scale = max(width, height)
        stroke = max(2, scale // 300)
        font = _load_font(max(13, scale // 48))
        colour = (245, 158, 11) if simulated else (20, 184, 166)

        for index, det in enumerate(detections, start=1):
            x1, y1, x2, y2 = det["bbox"]
            draw.rectangle([x1, y1, x2, y2], outline=colour + (255,), width=stroke)
            draw.rectangle([x1, y1, x2, y2], fill=colour + (28,))
            label = f"{index}. {det['class_name']}  {det['score']:.2f}"
            label = label.encode("latin-1", "replace").decode("latin-1") if isinstance(
                font, ImageFont.ImageFont
            ) else label
            left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
            text_w, text_h = right - left, bottom - top
            pad = max(3, stroke * 2)
            box_top = y1 - text_h - 2 * pad
            if box_top < 0:
                box_top = y1
            # Keep the whole label inside the image when the box is near the right edge.
            box_left = max(0, min(x1, width - (text_w + 2 * pad)))
            draw.rectangle(
                [box_left, box_top, box_left + text_w + 2 * pad, box_top + text_h + 2 * pad],
                fill=colour + (235,),
            )
            draw.text((box_left + pad, box_top + pad - top), label, fill=(15, 23, 42, 255), font=font)

        if simulated:
            banner_font = _load_font(max(15, scale // 34))
            text = "SIMULATED DEMO - NOT A REAL ANALYSIS"
            left, top, right, bottom = draw.textbbox((0, 0), text, font=banner_font)
            banner_h = (bottom - top) + max(16, scale // 40)
            for y0 in (0, height - banner_h):
                draw.rectangle([0, y0, width, y0 + banner_h], fill=(180, 83, 9, 235))
                draw.text(
                    ((width - (right - left)) / 2, y0 + (banner_h - (bottom - top)) / 2 - top),
                    text,
                    fill=(255, 255, 255, 255),
                    font=banner_font,
                )
        return image.convert("RGB")


_service: YoloService | None = None


def get_yolo_service() -> YoloService:
    global _service
    if _service is None:
        _service = YoloService(get_settings())
    return _service
