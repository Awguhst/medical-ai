"""Registry of the tools Claude is allowed to call.

Claude can only trigger what is registered here. Every call goes through
`ToolRegistry.execute`, which checks the tool name, validates the input
against a Pydantic model, applies a timeout and converts any failure into a
structured error result. There is no code-execution or shell tool, and no
path by which the model could reach one.

Adding a tool later means writing one handler and one `registry.register(...)`
call; the chat loop in `claude_service.py` does not change.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import BaseModel, ValidationError

from config import Settings, get_settings
from models.schemas import AnalyzeXrayInput, FindDoctorsInput, LookupMedicationInput, ReadDocumentInput
from services.document_service import get_document_reader
from services.framar_service import get_framar_service
from services.image_service import get_image_store
from services.safety_service import log_ref
from services.superdoc_service import get_superdoc_service
from services.yolo_service import get_yolo_service

logger = logging.getLogger("medai.tools")


@dataclass
class ToolContext:
    """Server-side facts about the current request. Never model-controlled."""

    session_id: str
    conversation_id: str
    demo_mode: bool
    settings: Settings


@dataclass
class ToolOutcome:
    payload: dict[str, Any]  # returned to Claude inside the tool_result block
    ui: dict[str, Any] = field(default_factory=dict)  # sent to the browser
    is_error: bool = False


ToolHandler = Callable[[BaseModel, ToolContext], Awaitable[ToolOutcome]]


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]  # JSON Schema advertised to Claude
    input_model: type[BaseModel]  # authoritative server-side validation
    handler: ToolHandler
    ui_label: str  # human-readable name shown in the chat
    ui_running_text: str
    timeout_seconds: float | None = None


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"tool already registered: {spec.name}")
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def api_schemas(self) -> list[dict[str, Any]]:
        """Tool definitions in Anthropic Messages API format (stable order)."""
        return [
            {
                "name": spec.name,
                "description": spec.description,
                "input_schema": spec.input_schema,
                "strict": True,
            }
            for spec in self._tools.values()
        ]

    async def execute(self, name: str, raw_input: Any, ctx: ToolContext) -> ToolOutcome:
        spec = self._tools.get(name)
        if spec is None:
            logger.warning("model requested an unregistered tool")
            return ToolOutcome(
                {"status": "error", "error": "unknown_tool", "message": "This tool does not exist."},
                {"status": "error", "message": "Заявен е непознат инструмент."},
                is_error=True,
            )
        try:
            parsed = spec.input_model.model_validate(raw_input)
        except ValidationError:
            return ToolOutcome(
                {
                    "status": "error",
                    "error": "invalid_input",
                    "message": "The tool input did not match the required schema.",
                },
                {"status": "error", "message": "Невалидни входни данни за инструмента."},
                is_error=True,
            )

        timeout = spec.timeout_seconds or ctx.settings.tool_timeout_seconds
        try:
            return await asyncio.wait_for(spec.handler(parsed, ctx), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("tool %s timed out (conv %s)", name, log_ref(ctx.conversation_id))
            return ToolOutcome(
                {"status": "timeout", "message": f"The tool did not finish within {timeout:.0f}s."},
                {"status": "timeout", "message": "Анализът отне твърде много време и беше прекратен."},
                is_error=True,
            )
        except Exception as exc:  # noqa: BLE001 - never leak internals to the model
            logger.error("tool %s failed: %s", name, type(exc).__name__)
            return ToolOutcome(
                {"status": "error", "error": "tool_failed", "message": "The tool failed unexpectedly."},
                {"status": "error", "message": "Възникна грешка при изпълнението на инструмента."},
                is_error=True,
            )


# --- analyze_xray ----------------------------------------------------------

_UI_MESSAGES = {
    "success": "AI анализът е завършен.",
    "simulated_demo": "Демо симулацията е завършена. Това не е реален анализ.",
    "model_not_configured": "Моделът на X-ray Analyzer не е конфигуриран на сървъра.",
    "model_incompatible": "Конфигурираният модел не е медицински и X-ray Analyzer не може да го използва.",
    "model_error": "Моделът на X-ray Analyzer не можа да бъде зареден.",
    "unsupported_image": "Изображението не изглежда като рентгенова снимка и не беше анализирано.",
    "image_not_found": "Изображението не е намерено или е изтекло. Прикачете го отново.",
    "error": "Възникна грешка при анализа на изображението.",
}


_TRIAGE_REJECTIONS = {
    "photo": (
        "Local image triage classified this upload as an ordinary photograph, not a "
        "radiograph, so it was not analysed. Ask the user to describe what the picture shows."
    ),
    "document": (
        "Local image triage classified this upload as a document (paper with text), not a "
        "radiograph, so it was not analysed. Use read_document for it."
    ),
    "scan": (
        "Local image triage classified this upload as a CT, MRI, ultrasound or mammography "
        "image, not a plain X-ray, so the X-ray detector was not run on it."
    ),
}


def _triage_rejection(record, min_confidence: float) -> str | None:
    """Reason to skip YOLO, when triage is confident the picture is not an X-ray."""
    label, confidence = record.content, record.content_confidence
    if label in {"photo", "document"} and confidence >= min_confidence:
        return _TRIAGE_REJECTIONS[label]
    # X-ray and CT slices can look alike: only a very confident "scan" blocks the run.
    if label == "scan" and confidence >= 0.8:
        return _TRIAGE_REJECTIONS[label]
    return None


async def _analyze_xray(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, AnalyzeXrayInput)
    store = get_image_store()

    # 1-2. The id must name an upload made in *this* conversation by *this* session.
    record = store.get(parsed.image_id, ctx.session_id, ctx.conversation_id, kind="upload")
    if record is None:
        payload = {
            "status": "image_not_found",
            "image_id": parsed.image_id,
            "message": (
                "No uploaded image with this id exists in the current conversation "
                "(it may have expired). Use an image_id from the attachment metadata."
            ),
        }
        return ToolOutcome(
            payload,
            {"status": "image_not_found", "message": _UI_MESSAGES["image_not_found"]},
            is_error=True,
        )

    if record.media != "image":
        return ToolOutcome(
            {
                "status": "unsupported_image",
                "image_id": record.image_id,
                "message": "This attachment is a PDF document, not an image. Use read_document for documents.",
            },
            {"status": "unsupported_image", "message": _UI_MESSAGES["unsupported_image"]},
        )

    triage = {"content": record.content, "confidence": round(record.content_confidence, 2)}

    # The local vision transformer already looked at the picture: a photo or a
    # page of text is not pushed through a chest X-ray detector.
    rejection = _triage_rejection(record, ctx.settings.image_triage_min_confidence)
    if rejection:
        return ToolOutcome(
            {
                "status": "unsupported_image",
                "image_id": record.image_id,
                "message": rejection,
                "triage": triage,
                "detections": [],
            },
            {"status": "unsupported_image", "message": _UI_MESSAGES["unsupported_image"]},
        )

    # 3-6. Weights check, inference and drawing run off the event loop.
    result = await asyncio.to_thread(
        get_yolo_service().analyze, record.path, record.image_id, ctx.demo_mode
    )

    payload = {"image_id": record.image_id, "triage": triage, **result.payload}
    status = payload["status"]

    annotated_id = None
    if result.annotated is not None:
        annotated = store.store_annotated(result.annotated, record)
        annotated_id = annotated.image_id
        payload["annotated_image_id"] = annotated_id

    ui = {
        "status": status,
        "message": _UI_MESSAGES.get(status, _UI_MESSAGES["error"]),
        "image_id": record.image_id,
        "annotated_image_id": annotated_id,
        "simulated": bool(payload.get("simulated")),
        "model_type": payload.get("model_type"),
        "model_classes": payload.get("model_classes", []),
        "score_threshold": payload.get("score_threshold"),
        "detections": payload.get("detections", []),
    }
    logger.info(
        "analyze_xray status=%s detections=%d conv=%s",
        status,
        len(ui["detections"]),
        log_ref(ctx.conversation_id),
    )
    return ToolOutcome(payload, ui, is_error=status in {"error", "model_error"})


# --- read_document -----------------------------------------------------------

_DOCUMENT_UI_MESSAGES = {
    "success": "Документът е разчетен.",
    "not_a_medical_document": "Файлът не изглежда като медицински документ.",
    "medical_image": "Файлът е медицинска снимка, а не текстов документ.",
    "unreadable": "Документът не можа да бъде разчетен достатъчно добре.",
    "document_not_found": "Файлът не е намерен или е изтекъл. Прикачете го отново.",
    "reader_unavailable": "В момента документът не може да бъде разчетен. Опитайте отново по-късно.",
    "too_long": "Документът е твърде дълъг, за да бъде разчетен наведнъж.",
    "not_read": "Документът не беше разчетен.",
}
_DOCUMENT_SENT = {"success", "not_a_medical_document", "medical_image", "unreadable", "too_long", "not_read"}


async def _read_document(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, ReadDocumentInput)
    record = get_image_store().get(parsed.image_id, ctx.session_id, ctx.conversation_id, kind="upload")
    if record is None:
        payload = {
            "status": "document_not_found",
            "image_id": parsed.image_id,
            "message": (
                "No uploaded file with this id exists in the current conversation "
                "(it may have expired). Use an image_id from the attachment metadata."
            ),
        }
        return ToolOutcome(
            payload, {"kind": "document", "status": "document_not_found",
                      "message": _DOCUMENT_UI_MESSAGES["document_not_found"]}, is_error=True,
        )

    payload = {"image_id": record.image_id, **(await get_document_reader().read(record))}
    status = payload["status"]
    ui = {
        "kind": "document",
        "status": status,
        "message": _DOCUMENT_UI_MESSAGES.get(status, _DOCUMENT_UI_MESSAGES["not_read"]),
        "file_name": record.filename,
        "file_type": record.media,
        "pages": record.pages,
        # Shown on the card, so the user sees that the file left this server.
        "sent_to_claude": status in _DOCUMENT_SENT,
        "document": payload.get("document"),
    }
    doc = payload.get("document") or {}
    logger.info(
        "read_document status=%s type=%s diagnoses=%d medications=%d tests=%d conv=%s",
        status, doc.get("document_type"), len(doc.get("diagnoses", [])), len(doc.get("medications", [])),
        len(doc.get("tests", [])), log_ref(ctx.conversation_id),
    )
    return ToolOutcome(payload, ui, is_error=status in {"reader_unavailable", "document_not_found"})


# --- find_doctors ------------------------------------------------------------

_DOCTOR_UI_MESSAGES = {
    "success": "Намерени са специалисти в Superdoc.",
    "no_results": "В Superdoc няма намерени лекари за това търсене.",
    "unknown_specialty": "Специалността не беше разпозната в Superdoc.",
    "unknown_city": "Населеното място не е налично в Superdoc.",
    "source_unavailable": "В момента няма връзка със Superdoc. Опитайте отново по-късно.",
}


async def _find_doctors(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, FindDoctorsInput)
    payload = await get_superdoc_service().search(parsed.specialty, parsed.city, parsed.sort)
    status = payload["status"]
    ui = {
        "kind": "doctors",
        "status": status,
        "message": _DOCTOR_UI_MESSAGES.get(status, "Търсенето не беше успешно."),
        "query": payload.get("query"),
        "search_url": payload.get("search_url"),
        "doctors": payload.get("doctors", []),
    }
    logger.info(
        "find_doctors status=%s results=%d conv=%s",
        status, len(ui["doctors"]), log_ref(ctx.conversation_id),
    )
    return ToolOutcome(payload, ui, is_error=status == "source_unavailable")


# --- lookup_medication -------------------------------------------------------

_MEDICATION_UI_MESSAGES = {
    "success": "Намерена е информация във Framar.",
    "partial": "Във Framar е намерена информация само за част от лекарствата.",
    "not_found": "Във Framar не беше намерено такова лекарство.",
    "source_unavailable": "В момента няма връзка с Framar. Опитайте отново по-късно.",
}


async def _lookup_medication(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, LookupMedicationInput)
    payload = await get_framar_service().lookup(parsed.medications)
    status = payload["status"]
    # The browser gets names and links only; the extracted text stays with the model.
    ui = {
        "kind": "medications",
        "status": status,
        "message": _MEDICATION_UI_MESSAGES.get(status, "Търсенето не беше успешно."),
        "medications": [
            {
                "query": m.get("query"),
                "status": m.get("status"),
                "kind": m.get("kind"),
                "name": m.get("name"),
                "active_ingredients": m.get("active_ingredients", []),
                "source_url": m.get("source_url"),
                "interactions_url": m.get("interactions_url"),
            }
            for m in payload["medications"]
        ],
        "interaction_checks": [
            {
                "between": c["between"],
                "status": c["status"],
                "severity": c.get("severity"),
                "same_active_ingredient": bool(c.get("same_active_ingredient")),
                "source_url": c.get("source_url"),
            }
            for c in payload.get("interaction_checks", [])
        ],
    }
    logger.info(
        "lookup_medication status=%s medications=%d checks=%d conv=%s",
        status, len(ui["medications"]), len(ui["interaction_checks"]), log_ref(ctx.conversation_id),
    )
    return ToolOutcome(payload, ui, is_error=status == "source_unavailable")


def build_registry() -> ToolRegistry:
    registry = ToolRegistry()
    if get_settings().framar_enabled:
        registry.register(
            ToolSpec(
                name="lookup_medication",
                description=(
                    "Look up medicines on framar.bg, a Bulgarian pharmacy and health reference "
                    "site, and check them against each other for interactions. Call this "
                    "BEFORE you say anything about how a medicine is taken: its dose, how and "
                    "how long to take it, what it is for, contraindications, side effects, "
                    "warnings, use in pregnancy or with alcohol, or whether it can be combined "
                    "with another medicine. That includes medicines you are about to suggest "
                    "yourself, not only ones the user named. Pass every medicine involved in "
                    "one call (up to 4): with two or more, each pair is also checked in "
                    "Framar's interaction checker. For each medicine the result gives the "
                    "matched Framar entry, its active ingredients with ATC codes, extracts of "
                    "the patient leaflet or active-ingredient page (uses, contraindications "
                    "and warnings, other medicines, dosage, side effects) and source links; "
                    "`interaction_checks` gives each pair's status (`documented` with "
                    "severity and text, `none_listed`, `not_checked`) and flags two products "
                    "with the same active ingredient. Names may be Bulgarian or English, "
                    "brand or active ingredient; the Bulgarian name of the active ingredient "
                    "(e.g. 'ибупрофен', 'ацетилсалицилова киселина') matches most reliably, "
                    "so use it unless the user asks about a specific branded product. Pass "
                    "only the medicine name, without dose, form or any other user text. If a "
                    "medicine comes back `not_found`, retry once with another name for it "
                    "(Bulgarian active ingredient, or one of the suggestions). `none_listed` "
                    "never means a combination is safe."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "medications": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "One to four medicine names, e.g. ['ибупрофен', 'варфарин'] or "
                                "['Нурофен']. Name only."
                            ),
                        }
                    },
                    "required": ["medications"],
                    "additionalProperties": False,
                },
                input_model=LookupMedicationInput,
                handler=_lookup_medication,
                ui_label="Framar: справка за лекарства",
                ui_running_text="Проверка на лекарствата във Framar...",
                timeout_seconds=50,
            )
        )
    if get_settings().superdoc_enabled:
        registry.register(
            ToolSpec(
                name="find_doctors",
                description=(
                    "Search superdoc.bg, a Bulgarian doctor-booking site, for medical "
                    "professionals by specialty and town. Returns the first page of "
                    "Superdoc's public listing: names, specialties, town, Superdoc user "
                    "rating, earliest shown appointment slot, and a profile link where the "
                    "user can book. Use it when the user asks to find, recommend or book a "
                    "doctor, or agrees to your offer to look for one. `specialty` is the "
                    "kind of doctor in Bulgarian (e.g. 'кардиолог', 'пулмолог', "
                    "'общопрактикуващ лекар'); choose the specialty that fits what the "
                    "user described. `city` is a Bulgarian town in Bulgarian (e.g. "
                    "'София'), or null to search all of Bulgaria; ask the user for their "
                    "town if you do not know it. If the result status is "
                    "`unknown_specialty` or `unknown_city`, it lists the valid options: "
                    "pick the closest one and call the tool again. Only the specialty, "
                    "town and sort order are sent to Superdoc."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "specialty": {
                            "type": "string",
                            "description": "Medical specialty in Bulgarian, e.g. 'кардиолог'.",
                        },
                        "city": {
                            "type": ["string", "null"],
                            "description": "Town in Bulgarian, e.g. 'Пловдив'. null = all of Bulgaria.",
                        },
                        "sort": {
                            "type": "string",
                            "enum": ["popular", "rating", "earliest"],
                            "description": (
                                "popular = most reviewed (default choice), rating = highest "
                                "rated, earliest = soonest available appointment."
                            ),
                        },
                    },
                    "required": ["specialty", "city", "sort"],
                    "additionalProperties": False,
                },
                input_model=FindDoctorsInput,
                handler=_find_doctors,
                ui_label="Superdoc: търсене на лекари",
                ui_running_text="Търсене на специалисти в Superdoc...",
                timeout_seconds=30,
            )
        )
    if get_settings().document_reader_enabled:
        registry.register(
            ToolSpec(
                name="read_document",
                description=(
                    "Read a medical document the user attached in this conversation: a "
                    "discharge summary (епикриза), outpatient record (амбулаторен лист), "
                    "laboratory results, an imaging report, a prescription or a referral, as "
                    "a photo, scan or PDF. The file is sent to a vision model that returns "
                    "structured content: document type and date, issuing institution, "
                    "diagnoses with any printed ICD-10 codes, medicines with dose and "
                    "schedule as written, test results with the reference ranges and flags "
                    "printed on the document, procedures, recommendations, follow-up, and a "
                    "list of parts that could not be read. The patient's name, national id "
                    "and address are left out on purpose. Call it when the user asks you to "
                    "read, explain or check an attached document, or attaches a PDF with a "
                    "question about it. Pass the image_id exactly as it appears in the "
                    "attachment metadata. Do not use it for X-ray films or other medical "
                    "pictures (use analyze_xray for X-rays), and do not call it again for a "
                    "file that already has a result in the conversation. Result `status`: "
                    "`success`, `not_a_medical_document`, `medical_image`, `unreadable`, "
                    "`document_not_found`, `reader_unavailable`, `too_long`, `not_read`."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "image_id": {
                            "type": "string",
                            "description": "Identifier of a file attached in the current conversation.",
                        }
                    },
                    "required": ["image_id"],
                    "additionalProperties": False,
                },
                input_model=ReadDocumentInput,
                handler=_read_document,
                ui_label="Четец на медицински документи",
                ui_running_text="Разчитане на документа...",
                timeout_seconds=150,
            )
        )
    registry.register(
        ToolSpec(
            name="analyze_xray",
            description=(
                "The X-ray Analyzer: analyze an uploaded X-ray image using a locally hosted, "
                "medically trained detection model (call it the X-ray Analyzer when talking "
                "to the user, never by its architecture). Returns structured object-detection "
                "results, including class labels, bounding boxes, and model scores. "
                "The tool does not establish a medical diagnosis. "
                "Call it as soon as the user attaches an image in this conversation, "
                "unless their words or the file name show it is a document (then use "
                "read_document). Do not wait for the user to ask for an analysis or to "
                "say that it is an X-ray: the attachment metadata carries a `content` label "
                "from a local vision model (`xray`, `scan`, `document`, `photo`, `unknown`) "
                "and a `suggested_tool`. For `xray` the application usually runs this tool "
                "itself at upload and puts the result in the message, so call it only when "
                "no result is present; call it yourself for `unknown`. It also "
                "checks for itself and returns `unsupported_image` for anything that is not "
                "a radiograph. Pass the image_id "
                "exactly as it appears in the attachment metadata. The result's "
                "`status` field says whether a real model ran (`success`), whether the "
                "output is a labelled simulation (`simulated_demo`), or why no analysis "
                "was possible (`model_not_configured`, `model_incompatible`, "
                "`unsupported_image`, `image_not_found`)."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "image_id": {
                        "type": "string",
                        "description": "Identifier of an image attached in the current conversation.",
                    }
                },
                "required": ["image_id"],
                "additionalProperties": False,
            },
            input_model=AnalyzeXrayInput,
            handler=_analyze_xray,
            ui_label="X-ray Analyzer",
            ui_running_text="Анализиране на изображението...",
        )
    )
    return registry


_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry


def default_context(session_id: str, conversation_id: str, demo_mode: bool) -> ToolContext:
    return ToolContext(session_id, conversation_id, demo_mode, get_settings())
