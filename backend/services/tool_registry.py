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
from i18n import DEFAULT_LANGUAGE, MESSAGES, localize, tr
from models.schemas import AnalyzeImageInput, FindDoctorsInput, LookupMedicationInput, ReadDocumentInput
from services.document_service import get_document_reader
from services.framar_service import get_framar_service
from services.image_reader_service import get_image_reader
from services.image_service import get_image_store
from services.safety_service import log_ref
from services.superdoc_service import get_superdoc_service

logger = logging.getLogger("medai.tools")


@dataclass
class ToolContext:
    """Server-side facts about the current request. Never model-controlled."""

    session_id: str
    conversation_id: str
    settings: Settings
    language: str = DEFAULT_LANGUAGE  # of the interface; selects the user-facing texts


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
    ui_label: dict[str, str]  # name shown in the chat, per interface language ("bg", "en")
    ui_running_text: dict[str, str]
    timeout_seconds: float | None = None

    def label(self, language: str) -> str:
        return localize(self.ui_label, language)

    def running_text(self, language: str) -> str:
        return localize(self.ui_running_text, language)


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
                {"status": "error", "message": tr(ctx.language, "tool.unknown")},
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
                {"status": "error", "message": tr(ctx.language, "tool.invalid_input")},
                is_error=True,
            )

        timeout = spec.timeout_seconds or ctx.settings.tool_timeout_seconds
        try:
            return await asyncio.wait_for(spec.handler(parsed, ctx), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("tool %s timed out (conv %s)", name, log_ref(ctx.conversation_id))
            return ToolOutcome(
                {"status": "timeout", "message": f"The tool did not finish within {timeout:.0f}s."},
                {"status": "timeout", "message": tr(ctx.language, "tool.timeout")},
                is_error=True,
            )
        except Exception as exc:  # noqa: BLE001 - never leak internals to the model
            logger.error("tool %s failed: %s", name, type(exc).__name__)
            return ToolOutcome(
                {"status": "error", "error": "tool_failed", "message": "The tool failed unexpectedly."},
                {"status": "error", "message": tr(ctx.language, "tool.failed")},
                is_error=True,
            )


def _ui_message(language: str, tool: str, status: str, fallback: str) -> str:
    """Status line of the tool card, in the interface language (texts in i18n.py)."""
    key = f"{tool}.{status}"
    return tr(language, key if key in MESSAGES else f"{tool}.{fallback}")


# --- analyze_image ---------------------------------------------------------


_DOCUMENT_REJECTION = (
    "Local image triage classified this upload as a document (paper with text), not a "
    "medical picture, so it was not looked at. Use read_document for it."
)


async def _analyze_image(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, AnalyzeImageInput)
    store = get_image_store()

    # 1-2. The id must name an upload made in *this* conversation by *this* session.
    record = store.get(parsed.image_id, ctx.session_id, ctx.conversation_id, kind="upload")
    if record is None:
        payload = {
            "status": "image_not_found",
            "image_id": parsed.image_id,
            "message": (
                "No uploaded image with this id exists in the current conversation "
                "(it may have expired). Ask the user to attach the image again."
            ),
        }
        return ToolOutcome(
            payload,
            {"status": "image_not_found",
             "message": _ui_message(ctx.language, "analyze_image", "image_not_found", "error")},
        )
    if record.media != "image":
        return ToolOutcome(
            {
                "status": "unsupported_image",
                "image_id": record.image_id,
                "message": "This attachment is a PDF document, not an image. Use read_document for documents.",
            },
            {"status": "unsupported_image",
             "message": _ui_message(ctx.language, "analyze_image", "unsupported_image", "error")},
        )

    triage = {"content": record.content, "confidence": round(record.content_confidence, 2)}

    # A page of text is for the document reader, which keeps names out of the result.
    if record.content == "document" and record.content_confidence >= ctx.settings.image_triage_min_confidence:
        return ToolOutcome(
            {"status": "unsupported_image", "image_id": record.image_id, "message": _DOCUMENT_REJECTION,
             "triage": triage},
            {"status": "unsupported_image",
             "message": _ui_message(ctx.language, "analyze_image", "unsupported_image", "error")},
        )

    # 3. A separate Claude request describes the picture; the chat model gets only the result.
    payload = {
        "image_id": record.image_id,
        "triage": triage,
        **(await get_image_reader().read(record, parsed.context, ctx.language)),
    }
    status = payload["status"]
    reading = payload.get("reading") or {}
    ui = {
        "status": status,
        "message": _ui_message(ctx.language, "analyze_image", status, "error"),
        "image_id": record.image_id,
        "sent_to_claude": bool(payload.get("sent_to_claude", False)),
        "modality": reading.get("modality") or payload.get("modality"),
        "body_region": reading.get("body_region") or payload.get("body_region"),
    }
    logger.info(
        "analyze_image status=%s modality=%s findings=%d conv=%s",
        status, ui["modality"], len(reading.get("findings", [])), log_ref(ctx.conversation_id),
    )
    return ToolOutcome(payload, ui, is_error=status in {"error", "reader_unavailable"})


# --- read_document -----------------------------------------------------------

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
                      "message": _ui_message(ctx.language, "read_document", "document_not_found", "not_read")},
            is_error=True,
        )

    payload = {"image_id": record.image_id, **(await get_document_reader().read(record))}
    status = payload["status"]
    ui = {
        "kind": "document",
        "status": status,
        "message": _ui_message(ctx.language, "read_document", status, "not_read"),
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

async def _find_doctors(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, FindDoctorsInput)
    payload = await get_superdoc_service().search(parsed.specialty, parsed.city, parsed.sort)
    status = payload["status"]
    ui = {
        "kind": "doctors",
        "status": status,
        "message": _ui_message(ctx.language, "find_doctors", status, "failed"),
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

async def _lookup_medication(parsed: BaseModel, ctx: ToolContext) -> ToolOutcome:
    assert isinstance(parsed, LookupMedicationInput)
    payload = await get_framar_service().lookup(parsed.medications)
    status = payload["status"]
    # The browser gets names and links only; the extracted text stays with the model.
    ui = {
        "kind": "medications",
        "status": status,
        "message": _ui_message(ctx.language, "lookup_medication", status, "failed"),
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
                ui_label={"bg": "Framar: справка за лекарства", "en": "Framar: medication lookup"},
                ui_running_text={
                    "bg": "Проверка на лекарствата във Framar...",
                    "en": "Checking the medicines on Framar...",
                },
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
                ui_label={"bg": "Superdoc: търсене на лекари", "en": "Superdoc: doctor search"},
                ui_running_text={
                    "bg": "Търсене на специалисти в Superdoc...",
                    "en": "Searching for specialists on Superdoc...",
                },
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
                    "pictures (use analyze_image for those), and do not call it again for a "
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
                ui_label={"bg": "Четец на медицински документи", "en": "Medical document reader"},
                ui_running_text={"bg": "Разчитане на документа...", "en": "Reading the document..."},
                timeout_seconds=150,
            )
        )
    if get_settings().image_reader_enabled:
        registry.register(
            ToolSpec(
                name="analyze_image",
                description=(
                    "Look at an uploaded medical image (an X-ray, a CT or MRI slice, an "
                    "ultrasound, a mammogram, an ECG strip, a photo of skin, a wound or an eye) "
                    "with a vision model that returns a structured description: the kind of "
                    "image and body region, its quality, each finding with where it is on the "
                    "picture, how much it matters and how sure the reader is, an overall "
                    "impression, the limitations of the picture and what the radiologist's "
                    "report would add. The user sees none of this, only your words: report it "
                    "in the first person as what you see on the picture, in a doctor's words, "
                    "and never mention the tool or the model. It is a description by an AI, "
                    "not a diagnosis and not a validated detector. "
                    "Call it as soon as the user attaches an image in this conversation, unless "
                    "their words or the file name show it is a text document (then use "
                    "read_document). Do not wait for the user to ask: the attachment metadata "
                    "carries a `content` label from local triage (`xray`, `scan`, `document`, "
                    "`photo`, `unknown`) and a `suggested_tool`. For `xray` and `scan` the "
                    "application usually runs this tool itself at upload and puts the result in "
                    "the message, so call it only when no result is present; call it yourself "
                    "for `photo` and `unknown`. Pass the image_id exactly as it appears in the "
                    "attachment metadata, and in `context` the few facts that help a reader: "
                    "what the user says the picture is, their age, their complaint. Result "
                    "`status`: `success`, `not_medical_image`, `is_document`, `unreadable`, "
                    "`unsupported_image`, `image_not_found`, `reader_unavailable`, `not_read`."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "image_id": {
                            "type": "string",
                            "description": "Identifier of an image attached in the current conversation.",
                        },
                        "context": {
                            "type": "string",
                            "description": (
                                "Short clinical context for the reader: what the user says the "
                                "picture is, their age, their complaint. Empty if there is none."
                            ),
                        },
                    },
                    "required": ["image_id", "context"],
                    "additionalProperties": False,
                },
                input_model=AnalyzeImageInput,
                handler=_analyze_image,
                ui_label={"bg": "Анализ на изображение", "en": "Image analysis"},
                ui_running_text={"bg": "Разглеждане на снимката...", "en": "Looking at the image..."},
                timeout_seconds=150,
            )
        )
    return registry
    return registry


_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry


def default_context(
    session_id: str, conversation_id: str, language: str = DEFAULT_LANGUAGE
) -> ToolContext:
    return ToolContext(session_id, conversation_id, get_settings(), language)
