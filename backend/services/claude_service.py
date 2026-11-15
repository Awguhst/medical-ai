"""Claude conversation layer and the server-side tool-use loop.

Flow for one user turn (`stream_chat`):

1. Rebuild the message list from the browser's history. Only text and ids are
   accepted from the client; attachment metadata and earlier tool results are
   re-read from the server-side store.
2. Stream a Messages API request that carries the registered tool schemas.
3. If Claude stops with `tool_use`, validate and execute each requested tool
   through the registry, append the assistant turn unchanged, and return every
   result in ONE user message of `tool_result` blocks (the ordering the API
   requires).
4. Repeat until Claude answers without tools, bounded by MAX_TOOL_ITERATIONS;
   the last allowed request is sent with tool_choice "none".

An upload the local vision model recognised as an X-ray skips the model's
decision: `analyze_xray` runs before the first request, its card is streamed
at once, and the result goes into the user turn as a completed tool result.

The generator yields plain dict events that the router serialises as SSE.
This conversation never carries file bytes: uploads are described by metadata.
(The read_document tool makes its own separate request with the file; see
document_service.py.)
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any, AsyncIterator

import anthropic

from config import Settings, get_settings
from models.schemas import ChatRequest
from prompts.medical_system_prompt import MEDICAL_SYSTEM_PROMPT
from services.image_service import ImageRecord, ImageStore, get_image_store
from services.safety_service import clean_text, detect_emergency, log_ref
from services.tool_registry import ToolContext, ToolRegistry, get_registry

# Which tool fits an upload, from the local image triage label.
_TOOL_FOR_CONTENT = {"xray": "analyze_xray", "document": "read_document"}

# The prompt asks for no long dashes; this guarantees none reach the chat.
_NO_LONG_DASHES = str.maketrans({"\u2014": "-", "\u2013": "-", "\u2015": "-"})

logger = logging.getLogger("medai.claude")

# Models whose safety classifiers can decline a request (stop_reason "refusal")
# and that support the server-side fallback beta. Health questions occasionally
# trip those classifiers, so the fallback is enabled for them by default.
_FALLBACK_MODELS = {
    "claude-fable-5-2",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
}
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_MAX_PAUSE_RESUMES = 3

_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        settings = get_settings()
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.claude_timeout_seconds,
            max_retries=2,
        )
    return _client


# --- message construction ---------------------------------------------------


def _suggested_tool(record: ImageRecord, available_tools: set[str] | None) -> str | None:
    """The tool the triage label points at, if that tool is registered."""
    tool = "read_document" if record.media == "pdf" else _TOOL_FOR_CONTENT.get(record.content)
    if tool and available_tools is not None and tool not in available_tools:
        return None
    return tool


def _attachments_block(
    ids: list[str],
    store: ImageStore,
    session_id: str,
    conversation_id: str,
    available_tools: set[str] | None = None,
) -> str:
    """Describe attachments by metadata only. File names are user-controlled
    and are already sanitised by the image store. `content` is the label the
    local vision transformer gave the picture (see image_triage_service)."""
    items: list[dict[str, Any]] = []
    for image_id in ids:
        record = store.get(image_id, session_id, conversation_id, kind="upload")
        if record is None:
            items.append({"image_id": image_id, "available": False, "note": "expired or unknown"})
        else:
            items.append(
                {
                    "image_id": record.image_id,
                    "file_name": record.filename,
                    "type": record.media,
                    **({"pages": record.pages} if record.media == "pdf"
                       else {"width": record.width, "height": record.height}),
                    "content": record.content,
                    "content_confidence": round(record.content_confidence, 2),
                    "suggested_tool": _suggested_tool(record, available_tools),
                    "available": True,
                }
            )
    return "<attachments>\n" + json.dumps(items, ensure_ascii=False) + "\n</attachments>"


def _xray_uploads(
    request: ChatRequest, store: ImageStore, session_id: str, registry: ToolRegistry, settings: Settings
) -> list[ImageRecord]:
    """New uploads the local vision model recognised as X-rays. The application
    runs analyze_xray on them itself, before Claude answers, so the user never
    has to ask and the model never has to decide. (Forcing the call through
    tool_choice is not supported by every model.) Only the current message
    counts: earlier attachments already had their turn."""
    if registry.get("analyze_xray") is None:
        return []
    records: list[ImageRecord] = []
    for image_id in request.message.attachment_ids[: settings.max_attachments_per_message]:
        record = store.get(image_id, session_id, request.conversation_id, kind="upload")
        if record is not None and record.media == "image" and record.content == "xray":
            records.append(record)
    return records


def _app_tool_result_block(tool: str, image_id: str, payload: dict[str, Any]) -> str:
    """A tool result the application produced itself, in the same shape as the
    replayed results of earlier turns, plus a note so Claude does not repeat
    the call."""
    body = json.dumps(payload, ensure_ascii=False)
    return (
        f'<previous_tool_result tool="{tool}" run_by="application" image_id="{image_id}">\n'
        f"{body}\n</previous_tool_result>\n"
        f"(The application already ran {tool} on image {image_id} because its local vision model "
        f"recognised an X-ray. Treat the result above as your own tool call: do not call {tool} "
        f"again for this image; report what it found and continue the consultation.)"
    )


def _previous_results_block(
    ids: list[str], store: ImageStore, session_id: str, conversation_id: str
) -> str:
    parts = []
    for result_id in ids:
        record = store.get_tool_result(result_id, session_id, conversation_id)
        if record is None:
            body = json.dumps({"status": "unavailable", "message": "This earlier result has expired."})
            tool = "unknown"
        else:
            body = json.dumps(record.payload, ensure_ascii=False)
            tool = record.tool_name
        parts.append(f'<previous_tool_result tool="{tool}">\n{body}\n</previous_tool_result>')
    return "\n".join(parts)


def build_messages(
    request: ChatRequest,
    session_id: str,
    store: ImageStore,
    settings: Settings,
    available_tools: set[str] | None = None,
) -> list[dict[str, Any]]:
    conv = request.conversation_id
    history = request.history[-settings.max_history_messages :]
    turns = [(m.role, m.text, m.attachment_ids, m.tool_result_ids) for m in history]
    turns.append(("user", request.message.text, request.message.attachment_ids, []))

    messages: list[dict[str, Any]] = []
    pending_results: list[str] = []  # tool results from the preceding assistant turn

    for role, raw_text, attachment_ids, tool_result_ids in turns:
        text = clean_text(raw_text, 40_000 if role == "assistant" else settings.max_message_chars)
        if role == "assistant":
            pending_results.extend(tool_result_ids)
            if text and messages:  # skip empty turns and a leading assistant turn
                messages.append({"role": "assistant", "content": text})
            continue

        parts: list[str] = []
        if pending_results:
            parts.append(_previous_results_block(pending_results, store, session_id, conv))
            pending_results = []
        ids = attachment_ids[: settings.max_attachments_per_message]
        if ids:
            parts.append(_attachments_block(ids, store, session_id, conv, available_tools))
        parts.append(text or "(Потребителят изпрати съобщение без текст.)")
        messages.append({"role": "user", "content": "\n\n".join(parts)})

    return messages


# --- request parameters -----------------------------------------------------


def _request_kwargs(settings: Settings, registry: ToolRegistry) -> tuple[bool, dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "model": settings.anthropic_model,
        "max_tokens": settings.anthropic_max_tokens,
        # Stable prefix (tools + system) is marked cacheable.
        "system": [
            {
                "type": "text",
                "text": MEDICAL_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "tools": registry.api_schemas(),
    }
    if settings.anthropic_effort:
        kwargs["output_config"] = {"effort": settings.anthropic_effort}

    use_fallback = (
        settings.anthropic_refusal_fallback and settings.anthropic_model in _FALLBACK_MODELS
    )
    if use_fallback:
        kwargs["betas"] = [_FALLBACK_BETA]
        kwargs["fallbacks"] = "default"
    return use_fallback, kwargs


def _error_event(code: str, message: str) -> dict[str, Any]:
    return {"type": "error", "code": code, "message": message}


def _api_error_event(exc: Exception, settings: Settings) -> dict[str, Any]:
    """Map SDK exceptions to user-facing Bulgarian messages (most specific first)."""
    if isinstance(exc, anthropic.AuthenticationError):
        return _error_event(
            "claude_auth", "Невалиден API ключ за Claude. Проверете ANTHROPIC_API_KEY на сървъра."
        )
    if isinstance(exc, anthropic.PermissionDeniedError):
        return _error_event(
            "claude_permission", "API ключът няма достъп до избрания Claude модел."
        )
    if isinstance(exc, anthropic.NotFoundError):
        return _error_event(
            "claude_model_not_found",
            f"Моделът „{settings.anthropic_model}“ не е намерен. Проверете ANTHROPIC_MODEL.",
        )
    if isinstance(exc, anthropic.RateLimitError):
        return _error_event(
            "claude_rate_limited", "Твърде много заявки към Claude. Опитайте отново след малко."
        )
    if isinstance(exc, anthropic.BadRequestError):
        return _error_event(
            "claude_bad_request",
            "Claude отхвърли заявката. Проверете конфигурацията на модела на сървъра.",
        )
    if isinstance(exc, anthropic.APITimeoutError):
        return _error_event("claude_timeout", "Claude не отговори навреме. Опитайте отново.")
    if isinstance(exc, anthropic.APIConnectionError):
        return _error_event(
            "claude_unreachable", "Няма връзка с Claude API. Проверете интернет връзката на сървъра."
        )
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code >= 500:
            return _error_event(
                "claude_unavailable", "Claude API е временно недостъпен. Опитайте отново след малко."
            )
        return _error_event("claude_error", "Възникна грешка при заявката към Claude.")
    return _error_event("internal_error", "Възникна неочаквана грешка на сървъра.")


# --- main loop ----------------------------------------------------------------


async def stream_chat(request: ChatRequest, session_id: str) -> AsyncIterator[dict[str, Any]]:
    settings = get_settings()
    registry = get_registry()
    store = get_image_store()
    conv = request.conversation_id
    ctx = ToolContext(session_id, conv, request.demo_mode, settings)

    # Deterministic safety net: show the 112 banner before the model answers.
    if detect_emergency(request.message.text):
        yield {"type": "emergency"}

    messages = build_messages(request, session_id, store, settings, set(registry.names()))

    # New uploads recognised as X-rays: run the detector now, stream the card
    # to the browser, and give Claude the result as an already completed call.
    app_blocks: list[str] = []
    for record in _xray_uploads(request, store, session_id, registry, settings):
        spec = registry.get("analyze_xray")
        tool_use_id = "app_" + secrets.token_urlsafe(12)
        yield {
            "type": "tool_start",
            "tool_use_id": tool_use_id,
            "tool_name": "analyze_xray",
            "label": spec.ui_label if spec else "analyze_xray",
            "running_text": spec.ui_running_text if spec else "",
        }
        outcome = await registry.execute("analyze_xray", {"image_id": record.image_id}, ctx)
        result_id = store.store_tool_result(session_id, conv, "analyze_xray", outcome.payload)
        yield {
            "type": "tool_end",
            "tool_use_id": tool_use_id,
            "result_id": result_id,
            "is_error": outcome.is_error,
            "result": outcome.ui,
        }
        app_blocks.append(_app_tool_result_block("analyze_xray", record.image_id, outcome.payload))
    if app_blocks:
        current = messages[-1]  # the user turn being answered; always text content
        messages[-1] = {"role": "user", "content": "\n\n".join(app_blocks) + "\n\n" + str(current["content"])}

    use_fallback, kwargs = _request_kwargs(settings, registry)
    client = get_client()
    streamer = client.beta.messages.stream if use_fallback else client.messages.stream

    tool_rounds = 0
    pause_resumes = 0
    final = None

    while True:
        call_kwargs = dict(kwargs, messages=messages)
        if tool_rounds >= settings.max_tool_iterations:
            # Iteration budget spent: Claude must now answer in text.
            call_kwargs["tool_choice"] = {"type": "none"}

        try:
            async with streamer(**call_kwargs) as stream:
                async for event in stream:
                    if event.type == "text":
                        yield {"type": "text_delta", "text": event.text.translate(_NO_LONG_DASHES)}
                final = await stream.get_final_message()
        except anthropic.APIError as exc:
            status = getattr(exc, "status_code", None)
            # exc.message comes from the API and describes the request, not the user content.
            logger.warning(
                "Claude API error: %s status=%s msg=%s",
                type(exc).__name__, status, str(getattr(exc, "message", ""))[:300],
            )
            yield _api_error_event(exc, settings)
            return
        except Exception as exc:  # noqa: BLE001
            logger.error("chat stream failed: %s", type(exc).__name__)
            yield _api_error_event(exc, settings)
            return

        stop_reason = final.stop_reason

        if stop_reason == "refusal":
            yield {
                "type": "notice",
                "code": "refusal",
                "message": (
                    "Моделът отказа да отговори на тази заявка поради вградените си "
                    "правила за безопасност. Опитайте да я формулирате по друг начин."
                ),
            }
            break

        if stop_reason == "pause_turn" and pause_resumes < _MAX_PAUSE_RESUMES:
            pause_resumes += 1
            messages.append({"role": "assistant", "content": final.content})
            continue

        tool_uses = [block for block in final.content if block.type == "tool_use"]

        if stop_reason == "max_tokens":
            # A truncated tool call must not be executed.
            yield {
                "type": "notice",
                "code": "max_tokens",
                "message": "Отговорът беше прекъснат, защото достигна максималната дължина.",
            }
            break

        if not tool_uses:
            break

        # Assistant turn goes back unchanged (thinking + tool_use blocks intact).
        messages.append({"role": "assistant", "content": final.content})

        tool_results: list[dict[str, Any]] = []
        for block in tool_uses:
            spec = registry.get(block.name)
            yield {
                "type": "tool_start",
                "tool_use_id": block.id,
                "tool_name": block.name if spec else "unknown",
                "label": spec.ui_label if spec else "Непознат инструмент",
                "running_text": spec.ui_running_text if spec else "",
            }
            outcome = await registry.execute(block.name, block.input, ctx)
            result_id = store.store_tool_result(
                session_id, conv, block.name if spec else "unknown", outcome.payload
            )
            yield {
                "type": "tool_end",
                "tool_use_id": block.id,
                "result_id": result_id,
                "is_error": outcome.is_error,
                "result": outcome.ui,
            }
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(outcome.payload, ensure_ascii=False),
                    "is_error": outcome.is_error,
                }
            )

        # All results for this assistant turn travel in a single user message.
        messages.append({"role": "user", "content": tool_results})
        tool_rounds += 1

    logger.info(
        "chat turn done conv=%s stop=%s tool_rounds=%d app_xray_runs=%d",
        log_ref(conv), getattr(final, "stop_reason", None), tool_rounds, len(app_blocks),
    )
    yield {
        "type": "done",
        "stop_reason": getattr(final, "stop_reason", None),
        "model": getattr(final, "model", settings.anthropic_model),
    }
