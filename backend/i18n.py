"""User-facing messages in the languages the interface offers.

The browser says which language it is showing with the standard
``Accept-Language`` header (``bg`` or ``en``). Everything the API sends back for
a person to read (error messages, tool status lines, tool names in the chat) is
looked up here by a stable key; text meant for the model stays in English in
the services. Bulgarian is the default and the fallback.
"""

from __future__ import annotations

from typing import Literal, Mapping

Language = Literal["bg", "en"]
LANGUAGES: tuple[Language, ...] = ("bg", "en")
DEFAULT_LANGUAGE: Language = "bg"


def parse_language(accept_language: str | None) -> Language:
    """First supported language in an Accept-Language header, Bulgarian otherwise.

    ``en``, ``en-GB,en;q=0.9`` and ``de,en;q=0.5`` all give ``en``; ``fr`` gives ``bg``.
    """
    for part in (accept_language or "").split(","):
        tag = part.split(";", 1)[0].strip().lower()
        primary = tag.split("-", 1)[0]
        if primary in LANGUAGES:
            return primary  # type: ignore[return-value]
    return DEFAULT_LANGUAGE


def localize(texts: Mapping[str, str], language: str) -> str:
    """One language out of a {language: text} mapping, falling back to Bulgarian."""
    return texts.get(language) or texts.get(DEFAULT_LANGUAGE) or next(iter(texts.values()), "")


def tr(language: str, key: str, **params: object) -> str:
    """The message for `key` in `language`, with its {placeholders} filled in."""
    text = localize(MESSAGES[key], language)
    return text.format(**params) if params else text


MESSAGES: dict[str, dict[str, str]] = {
    # --- HTTP errors -------------------------------------------------------
    "invalid_request": {"bg": "Невалидна заявка.", "en": "Invalid request."},
    "invalid_session": {
        "bg": "Липсва или е невалидна сесия.",
        "en": "The session is missing or invalid.",
    },
    "invalid_id.conversation": {
        "bg": "Невалиден идентификатор (разговор).",
        "en": "Invalid identifier (conversation).",
    },
    "invalid_id.image": {
        "bg": "Невалиден идентификатор (изображение).",
        "en": "Invalid identifier (image).",
    },
    "consent_required": {
        "bg": "Необходимо е съгласие, преди съобщенията да бъдат изпратени към Claude API.",
        "en": "Consent is required before messages can be sent to the Claude API.",
    },
    "claude_not_configured": {
        "bg": (
            "Claude API не е конфигуриран. Задайте ANTHROPIC_API_KEY във файла .env "
            "на сървъра и го рестартирайте."
        ),
        "en": (
            "The Claude API is not configured. Set ANTHROPIC_API_KEY in the server's .env "
            "file and restart it."
        ),
    },
    "message_too_long": {
        "bg": "Съобщението е твърде дълго (макс. {max_chars} знака).",
        "en": "The message is too long (max. {max_chars} characters).",
    },
    "empty_message": {"bg": "Съобщението е празно.", "en": "The message is empty."},
    "too_many_attachments": {
        "bg": "Най-много {max_files} изображения на съобщение.",
        "en": "At most {max_files} attachments per message.",
    },
    "internal_error": {
        "bg": "Възникна неочаквана грешка на сървъра.",
        "en": "An unexpected server error occurred.",
    },
    "image_not_found": {"bg": "Изображението не е налично.", "en": "The image is not available."},
    # --- uploads (ImageValidationError codes) --------------------------------
    "upload.empty_file": {"bg": "Файлът е празен.", "en": "The file is empty."},
    "upload.file_too_large": {
        "bg": "Файлът е твърде голям. Максимум {max_mb} MB.",
        "en": "The file is too large. The maximum is {max_mb} MB.",
    },
    "upload.unsupported_format": {
        "bg": "Неподдържан формат. Използвайте PNG, JPEG, WEBP, BMP или PDF.",
        "en": "Unsupported format. Use PNG, JPEG, WEBP, BMP or PDF.",
    },
    "upload.image_too_large": {
        "bg": "Изображението е твърде голямо (макс. {max_side}px по страна).",
        "en": "The image is too large (max. {max_side}px per side).",
    },
    "upload.image_too_small": {
        "bg": "Изображението е твърде малко (мин. {min_side}px по страна).",
        "en": "The image is too small (min. {min_side}px per side).",
    },
    "upload.not_an_image": {
        "bg": "Файлът не е валидно изображение или PDF. Използвайте PNG, JPEG, WEBP, BMP или PDF.",
        "en": "The file is not a valid image or PDF. Use PNG, JPEG, WEBP, BMP or PDF.",
    },
    "upload.too_many_images": {
        "bg": "Достигнат е лимитът за изображения в този разговор.",
        "en": "This conversation has reached its image limit.",
    },
    "upload.too_many_files": {
        "bg": "Достигнат е лимитът за файлове в този разговор.",
        "en": "This conversation has reached its file limit.",
    },
    "upload.not_a_pdf": {
        "bg": "Файлът не е валиден PDF документ.",
        "en": "The file is not a valid PDF document.",
    },
    "upload.pdf_no_pages": {"bg": "PDF документът няма страници.", "en": "The PDF document has no pages."},
    "upload.pdf_encrypted": {
        "bg": "PDF документът е защитен с парола и не може да бъде прочетен.",
        "en": "The PDF document is password-protected and cannot be read.",
    },
    "upload.pdf_too_long": {
        "bg": "PDF документът има {pages} страници. Максимумът е {max_pages}.",
        "en": "The PDF document has {pages} pages. The maximum is {max_pages}.",
    },
    # --- Claude API failures (streamed as error events) ----------------------
    "claude_auth": {
        "bg": "Невалиден API ключ за Claude. Проверете ANTHROPIC_API_KEY на сървъра.",
        "en": "Invalid Claude API key. Check ANTHROPIC_API_KEY on the server.",
    },
    "claude_permission": {
        "bg": "API ключът няма достъп до избрания Claude модел.",
        "en": "The API key has no access to the selected Claude model.",
    },
    "claude_model_not_found": {
        "bg": "Моделът „{model}“ не е намерен. Проверете ANTHROPIC_MODEL.",
        "en": "The model \"{model}\" was not found. Check ANTHROPIC_MODEL.",
    },
    "claude_rate_limited": {
        "bg": "Твърде много заявки към Claude. Опитайте отново след малко.",
        "en": "Too many requests to Claude. Try again in a moment.",
    },
    "claude_bad_request": {
        "bg": "Claude отхвърли заявката. Проверете конфигурацията на модела на сървъра.",
        "en": "Claude rejected the request. Check the model configuration on the server.",
    },
    "claude_timeout": {
        "bg": "Claude не отговори навреме. Опитайте отново.",
        "en": "Claude did not answer in time. Try again.",
    },
    "claude_unreachable": {
        "bg": "Няма връзка с Claude API. Проверете интернет връзката на сървъра.",
        "en": "Cannot reach the Claude API. Check the server's internet connection.",
    },
    "claude_unavailable": {
        "bg": "Claude API е временно недостъпен. Опитайте отново след малко.",
        "en": "The Claude API is temporarily unavailable. Try again in a moment.",
    },
    "claude_error": {
        "bg": "Възникна грешка при заявката към Claude.",
        "en": "The request to Claude failed.",
    },
    # --- notices shown under a reply ------------------------------------------
    "notice.refusal": {
        "bg": (
            "Моделът отказа да отговори на тази заявка поради вградените си "
            "правила за безопасност. Опитайте да я формулирате по друг начин."
        ),
        "en": (
            "The model declined this request because of its built-in safety rules. "
            "Try phrasing it differently."
        ),
    },
    "notice.max_tokens": {
        "bg": "Отговорът беше прекъснат, защото достигна максималната дължина.",
        "en": "The reply was cut off because it reached the maximum length.",
    },
    # --- placeholder for a message with attachments only (seen by the model) --
    "empty_user_message": {
        "bg": "(Потребителят изпрати съобщение без текст.)",
        "en": "(The user sent a message without text.)",
    },
    # --- tool cards: generic ----------------------------------------------------
    "tool.unknown_label": {"bg": "Непознат инструмент", "en": "Unknown tool"},
    "tool.unknown": {"bg": "Заявен е непознат инструмент.", "en": "An unknown tool was requested."},
    "tool.invalid_input": {
        "bg": "Невалидни входни данни за инструмента.",
        "en": "Invalid input for the tool.",
    },
    "tool.timeout": {
        "bg": "Анализът отне твърде много време и беше прекратен.",
        "en": "The operation took too long and was stopped.",
    },
    "tool.failed": {
        "bg": "Възникна грешка при изпълнението на инструмента.",
        "en": "The tool failed to run.",
    },
    # --- tool cards: analyze_image ----------------------------------------------
    "analyze_image.success": {"bg": "Снимката беше разгледана.", "en": "The image has been looked at."},
    "analyze_image.not_medical_image": {
        "bg": "Снимката не изглежда като медицинско изображение.",
        "en": "The picture does not look like a medical image.",
    },
    "analyze_image.is_document": {
        "bg": "Снимката е документ с текст; за него се използва четецът на документи.",
        "en": "The picture is a text document; the document reader is for that.",
    },
    "analyze_image.unreadable": {
        "bg": "Снимката е твърде неясна, за да бъде разгледана.",
        "en": "The image is too unclear to be looked at.",
    },
    "analyze_image.unsupported_image": {
        "bg": "Файлът е документ, не медицинско изображение; за него се използва четецът на документи.",
        "en": "The file is a document, not a medical image; the document reader is for that.",
    },
    "analyze_image.image_not_found": {
        "bg": "Изображението не е намерено или е изтекло. Прикачете го отново.",
        "en": "The image was not found or has expired. Attach it again.",
    },
    "analyze_image.reader_unavailable": {
        "bg": "Снимката не можа да бъде разгледана в момента. Опитайте отново по-късно.",
        "en": "The image could not be looked at right now. Try again later.",
    },
    "analyze_image.not_read": {"bg": "Снимката не беше разгледана.", "en": "The image was not looked at."},
    "analyze_image.error": {
        "bg": "Възникна грешка при разглеждането на снимката.",
        "en": "The image analysis failed.",
    },
    # --- tool cards: read_document ----------------------------------------------
    "read_document.success": {"bg": "Документът е разчетен.", "en": "The document has been read."},
    "read_document.not_a_medical_document": {
        "bg": "Файлът не изглежда като медицински документ.",
        "en": "The file does not look like a medical document.",
    },
    "read_document.medical_image": {
        "bg": "Файлът е медицинска снимка, а не текстов документ.",
        "en": "The file is a medical image, not a text document.",
    },
    "read_document.unreadable": {
        "bg": "Документът не можа да бъде разчетен достатъчно добре.",
        "en": "The document could not be read well enough.",
    },
    "read_document.document_not_found": {
        "bg": "Файлът не е намерен или е изтекъл. Прикачете го отново.",
        "en": "The file was not found or has expired. Attach it again.",
    },
    "read_document.reader_unavailable": {
        "bg": "В момента документът не може да бъде разчетен. Опитайте отново по-късно.",
        "en": "The document cannot be read right now. Try again later.",
    },
    "read_document.too_long": {
        "bg": "Документът е твърде дълъг, за да бъде разчетен наведнъж.",
        "en": "The document is too long to be read in one go.",
    },
    "read_document.not_read": {"bg": "Документът не беше разчетен.", "en": "The document was not read."},
    # --- tool cards: find_doctors -----------------------------------------------
    "find_doctors.success": {
        "bg": "Намерени са специалисти в Superdoc.",
        "en": "Specialists were found on Superdoc.",
    },
    "find_doctors.no_results": {
        "bg": "В Superdoc няма намерени лекари за това търсене.",
        "en": "Superdoc has no doctors for this search.",
    },
    "find_doctors.unknown_specialty": {
        "bg": "Специалността не беше разпозната в Superdoc.",
        "en": "Superdoc did not recognise the specialty.",
    },
    "find_doctors.unknown_city": {
        "bg": "Населеното място не е налично в Superdoc.",
        "en": "That town is not available on Superdoc.",
    },
    "find_doctors.source_unavailable": {
        "bg": "В момента няма връзка със Superdoc. Опитайте отново по-късно.",
        "en": "Superdoc cannot be reached right now. Try again later.",
    },
    "find_doctors.failed": {"bg": "Търсенето не беше успешно.", "en": "The search was not successful."},
    # --- tool cards: lookup_medication ------------------------------------------
    "lookup_medication.success": {
        "bg": "Намерена е информация във Framar.",
        "en": "Information was found on Framar.",
    },
    "lookup_medication.partial": {
        "bg": "Във Framar е намерена информация само за част от лекарствата.",
        "en": "Framar had information for only some of the medicines.",
    },
    "lookup_medication.not_found": {
        "bg": "Във Framar не беше намерено такова лекарство.",
        "en": "No such medicine was found on Framar.",
    },
    "lookup_medication.source_unavailable": {
        "bg": "В момента няма връзка с Framar. Опитайте отново по-късно.",
        "en": "Framar cannot be reached right now. Try again later.",
    },
    "lookup_medication.failed": {"bg": "Търсенето не беше успешно.", "en": "The lookup was not successful."},
}
