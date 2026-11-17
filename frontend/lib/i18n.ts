import { createContext, useCallback, useContext } from "react";

import { DEFAULT_LANGUAGE } from "./preferences";
import type { Language } from "./types";

/**
 * Every string the interface shows, in Bulgarian (the source of the keys) and
 * English. Components read them through `useT()`; code outside React (api.ts)
 * uses `tr()`, which follows the language the app last applied. Text that
 * comes from the server (tool status lines, error messages) is already in the
 * right language: the API gets it from the Accept-Language header.
 */
const bg = {
  // --- app ------------------------------------------------------------------
  app_title: "MedAI Bulgaria: AI медицински асистент",

  // --- top bar, warnings, welcome screen (ChatInterface) ----------------------
  menu_open: "Отвори менюто",
  sidebar_show: "Покажи страничното меню",
  sidebar_hide: "Скрий страничното меню",
  sidebar_show_short: "Покажи менюто",
  sidebar_hide_short: "Скрий менюто",
  new_conversation: "Нов разговор",
  attached_file: "Прикачен файл",
  backend_down_1: "Няма връзка със сървъра на MedAI. Стартирайте бекенда (",
  backend_down_2: ") и опитайте отново.",
  claude_unconfigured_1: "Claude API не е конфигуриран. Задайте",
  claude_unconfigured_2: "във файла",
  claude_unconfigured_3: "и рестартирайте сървъра.",
  welcome_heading: "С какво мога да помогна?",
  welcome_text:
    "Здравейте! Аз съм MedAI, вашият AI медицински асистент. Можете да ме попитате за симптоми, заболявания, да прикачите рентгенова снимка за експериментален AI анализ или медицински документ, който да ви обясня.",
  suggestion_1: "Какви са симптомите на пневмония?",
  suggestion_2: "Имам главоболие от няколко дни.",
  suggestion_3: "Какво означава високо кръвно налягане?",
  suggestion_4: "Искам да анализирам рентгенова снимка.",
  xray_unavailable_incompatible:
    "Конфигурираният модел не е медицински, затова X-ray Analyzer е недостъпен.",
  xray_unavailable_missing:
    "Моделът на X-ray Analyzer не е конфигуриран на сървъра, затова реалният анализ на рентгенови снимки е недостъпен.",
  settings: "Настройки",
  scroll_to_latest: "Към последното съобщение",
  footer_disclaimer:
    "MedAI дава обща информация и не поставя диагноза. Не замества консултация с лекар.",
  footer_emergency_1: "При спешен случай се обадете на",
  footer_emergency_2: ".",
  unexpected_error: "Възникна неочаквана грешка.",

  // --- sidebar ----------------------------------------------------------------
  sidebar_label: "Странично меню",
  menu_close: "Затвори менюто",
  history_heading: "История на разговорите",
  history_empty: "Все още няма разговори. Историята се пази само в този раздел на браузъра.",
  delete_conversation: "Изтрий разговора",
  delete_conversation_named: "Изтрий разговора „{title}“",
  resize_sidebar: "Преоразмери страничното меню",
  resize_hint: "Плъзнете за преоразмеряване, двоен клик за връщане",

  // --- composer (ChatInput) ---------------------------------------------------
  content_xray: "Рентген",
  content_scan: "Скан",
  content_document: "Документ",
  content_photo: "Снимка",
  file_too_large: "Файлът е над 10 MB.",
  upload_failed: "Качването беше неуспешно.",
  drop_here: "Пуснете файла тук",
  remove_file: "Премахни {name}",
  attach: "Прикачи снимка или документ",
  attach_hint: "Прикачи рентгенова снимка или медицински документ (PNG, JPEG, WEBP, BMP, PDF)",
  composer_placeholder: "Опишете симптом или задайте въпрос...",
  composer_label: "Съобщение до MedAI",
  stop_reply: "Спри отговора",
  stop: "Спри",
  send: "Изпрати",
  send_hint: "Изпрати (Ctrl+Enter)",

  // --- messages (ChatMessage) -------------------------------------------------
  typing: "MedAI пише",
  emergency_title: "Възможен спешен случай",
  emergency_1: "Ако състоянието е тежко или се влошава, обадете се незабавно на",
  emergency_2: ". Не чакайте отговор от MedAI.",
  pdf_document: "PDF документ",
  pdf_page_one: "1 стр.",
  pdf_pages: "{count} стр.",
  attached_image_alt: "Прикачено изображение: {name}",
  reply_stopped: "Отговорът беше спрян.",
  retry: "Опитай отново",

  // --- consent dialog -----------------------------------------------------------
  consent_title: "Преди да започнете",
  consent_description: "Моля, прочетете как MedAI обработва здравната информация.",
  consent_1_title: "Не е лекар и не поставя диагноза",
  consent_1_text:
    "MedAI дава обща образователна информация. Тя не замества преглед, диагноза или лечение от медицински специалист.",
  consent_2_title: "Съобщенията се обработват от външна AI услуга",
  consent_2_text:
    "Текстът, който изпращате, се предава към Claude API на Anthropic, за да бъде генериран отговор. Не въвеждайте имена, ЕГН или други данни, по които можете да бъдете разпознати.",
  consent_3_title: "Рентгеновите снимки се анализират локално",
  consent_3_text:
    "Рентгеновите снимки се обработват само на сървъра на MedAI. Към Claude се изпращат единствено резултатите от анализа, не и самата снимка.",
  consent_4_title: "Медицинските документи се изпращат към Claude",
  consent_4_text:
    "Ако поискате да бъде разчетен документ (епикриза, изследвания, рецепта), самият файл се изпраща към Claude API заедно с всичко на него, включително име и ЕГН. Името, ЕГН и адресът не се извличат в разговора. Ако не желаете да ги изпращате, закрийте ги преди да снимате.",
  consent_5_title: "Търсене на лекари в Superdoc",
  consent_5_text:
    "Ако поискате да намерим специалист, към superdoc.bg се изпращат само специалността и населеното място. Резултатите не са препоръка от MedAI.",
  consent_6_title: "Справка за лекарства във Framar",
  consent_6_text:
    "Когато става дума за лекарство, към framar.bg се изпраща само името му. Информацията е справочна и не замества лекар или фармацевт.",
  consent_7_title: "Временно съхранение",
  consent_7_text:
    "Историята се пази само в този раздел на браузъра и изчезва при затварянето му. Качените снимки се изтриват автоматично от сървъра.",
  consent_emergency_lead: "При спешен случай",
  consent_emergency_body:
    "(силна болка в гърдите, затруднено дишане, признаци на инсулт) се обадете незабавно на",
  consent_emergency_after: ".",
  consent_prototype:
    "Това е прототип. Приложението не е медицинско изделие и не е сертифицирано за клинична употреба.",
  consent_checkbox:
    "Разбирам горното и съм съгласен/съгласна съобщенията ми и документите, които поискам да бъдат разчетени, да бъдат изпращани за обработка към Claude API (Anthropic).",
  consent_decline: "Не сега",
  consent_accept: "Съгласен съм и продължавам",

  // --- settings dialog -----------------------------------------------------------
  settings_description: "Състояние на системата, език и тема, изглед и поверителност.",
  section_status: "Състояние",
  status_server: "Сървър",
  status_no_connection: "Няма връзка",
  status_running: "Работи",
  status_checking: "Проверка...",
  status_claude: "Claude API",
  status_missing_key: "Липсва API ключ",
  status_no_data: "Няма данни",
  status_xray: "X-ray Analyzer",
  status_triage: "Разпознаване на снимки",
  yolo_ready: "Медицински модел: наличен",
  yolo_not_configured: "Моделът не е конфигуриран",
  yolo_weights_missing: "Файлът с теглата не е намерен",
  yolo_incompatible: "Теглата не са медицински модел",
  yolo_error: "Грешка при зареждане на модела",
  triage_ready: "Локален модел: наличен",
  triage_loading: "Зарежда се...",
  triage_disabled: "Изключено на сървъра",
  triage_not_installed: "Библиотеката не е инсталирана",
  triage_error: "Грешка при зареждане на модела",
  model_classes: "Класове на модела: {classes}",
  section_appearance: "Език и тема",
  language: "Език",
  language_hint: "Езикът на интерфейса и на отговорите на MedAI.",
  theme: "Тема",
  theme_hint: "Всички теми са тъмни; разликата е в топлината на цветовете.",
  theme_graphite: "Графит",
  theme_graphite_hint: "Неутрално черно, син акцент",
  theme_ember: "Жарава",
  theme_ember_hint: "Топло кафяво-черно, меден акцент",
  theme_dusk: "Здрач",
  theme_dusk_hint: "Тъмна слива, розов акцент",
  section_view: "Изглед",
  show_tools_title: "Показвай работата на инструментите",
  show_tools_text:
    "Карти със статус и сурови данни от всяка проверка: рентген, лекарства, лекари, документи. Изключено: виждате само отговора на MedAI.",
  section_privacy: "Поверителност",
  privacy_text:
    "Историята се пази само в този раздел на браузъра (sessionStorage). Съобщенията се обработват от Claude API. Рентгеновите снимки се анализират локално на сървъра. Документ, който поискате да бъде разчетен, се изпраща към Claude API. Качените файлове се изтриват автоматично. При търсене на лекар към superdoc.bg се изпращат само специалността и населеното място, а при справка за лекарство към framar.bg се изпраща само името му.",
  confirm_delete: "Да се изтрият ли всички разговори и качени снимки? Действието е необратимо.",
  confirm_delete_yes: "Да, изтрий всичко",
  cancel: "Отказ",
  delete_history: "Изтрий цялата история",
  revoke_consent: "Оттегли съгласието за обработка",
  consent_not_given: "Съгласието не е дадено",

  // --- doctor results (Superdoc) -------------------------------------------------
  search_label: "Търсене:",
  search_in: "в",
  search_all_bulgaria: "в цяла България",
  sponsored: "Спонсориран",
  reviews_count: "({count} оценки)",
  earliest_slot: "Най-ранен час: {when}",
  book: "Запази час",
  doctor_profile: "Профил на {name} в Superdoc",
  all_results_superdoc: "Виж всички резултати в Superdoc",
  doctors_disclaimer:
    "Данните са от публичните страници на superdoc.bg към момента на търсенето. Оценките са от потребители на Superdoc и не измерват качеството на лечение. MedAI не е свързан със Superdoc и не препоръчва конкретен лекар.",
  initials_fallback: "Д",

  // --- document results ------------------------------------------------------------
  readable_good: "Четлив",
  readable_partial: "Частично четлив",
  readable_poor: "Трудно четлив",
  med_ctx_prescribed: "Предписано",
  med_ctx_during_stay: "По време на престоя",
  med_ctx_previous: "Досегашна терапия",
  flag_high: "Над нормата",
  flag_low: "Под нормата",
  flag_abnormal: "Извън нормата",
  flag_normal: "В норма",
  flag_unknown: "Без посочена норма",
  medical_document: "Медицински документ",
  diagnoses: "Диагнози",
  medications: "Лекарства",
  tests: "Изследвания",
  recommendations: "Препоръки",
  reference_range: "норма",
  unreadable_parts: "Неразчетени части: {parts}.",
  doc_sent_to_claude:
    "За да бъде разчетен, файлът беше изпратен към Claude API (Anthropic) заедно с всичко, което се вижда на него. Името, ЕГН и адресът не се извличат и не се показват тук.",
  doc_not_sent: "Файлът не беше изпратен за разчитане.",
  doc_accuracy:
    "Разчитането е автоматично и може да съдържа грешки: сверете дозите и стойностите с оригинала. Това не е медицинско заключение.",

  // --- medication results (Framar) ---------------------------------------------------
  kind_product: "Листовка на продукт",
  kind_active_ingredient: "Активно вещество",
  kind_reference: "Справка",
  searched_for: "· търсено: „{query}“",
  med_unavailable: "Няма връзка с Framar за това лекарство.",
  med_not_found: "Не е намерено във Framar.",
  source: "Източник",
  med_in_framar: "{name} във Framar",
  interactions_heading: "Проверка за взаимодействия",
  ix_major_label: "Силно значимо",
  ix_major_text: "Framar описва силно клинично значимо взаимодействие.",
  ix_moderate_label: "Умерено значимо",
  ix_moderate_text: "Framar описва умерено клинично значимо взаимодействие.",
  ix_minor_label: "Слабо значимо",
  ix_documented_label: "Описано",
  ix_documented_text: "Framar описва взаимодействие между двете.",
  ix_same_label: "Едно и също вещество",
  ix_same_text: "Двата продукта съдържат едно и също активно вещество, затова дозите се събират.",
  ix_none_label: "Няма описано",
  ix_none_text:
    "Във Framar няма описано взаимодействие. Това не означава, че комбинацията е безопасна.",
  ix_unchecked_label: "Не е проверено",
  ix_unchecked_text: "Взаимодействието не можа да бъде проверено във Framar.",
  ix_also_same: "Двата продукта съдържат и едно и също активно вещество.",
  view_in_framar: "Виж във Framar",
  medications_disclaimer:
    "Данните са от публичните страници на framar.bg (листовки и справочник за взаимодействия) към момента на търсенето и са само за справка. Липсата на описано взаимодействие не доказва, че комбинацията е безопасна. Преди прием се консултирайте с лекар или фармацевт. MedAI не е свързан с Framar.",

  // --- tool card ---------------------------------------------------------------------
  tool_using: "MedAI използва инструмент",
  tool_running: "Изпълнение...",
  tool_finished: "Инструментът приключи.",

  // --- images ----------------------------------------------------------------------------
  image_unavailable:
    "Изображението вече не е налично (временните файлове се изтриват автоматично).",
  image_loading: "Зареждане на изображението",
  image_enlarge: "Увеличи: {alt}",
  image_enlarged: "Увеличен изглед на изображението",

  // --- dialogs -----------------------------------------------------------------------------
  close: "Затвори",

  // --- API client ----------------------------------------------------------------------------
  api_unreachable: "Няма връзка със сървъра на MedAI. Уверете се, че бекендът е стартиран.",
  api_server_error: "Грешка на сървъра ({status}).",
  api_empty_stream: "Сървърът не върна отговор.",
  api_stream_interrupted: "Връзката със сървъра прекъсна по време на отговора.",
};

export type MessageKey = keyof typeof bg;

const en: Record<MessageKey, string> = {
  app_title: "MedAI Bulgaria: AI medical assistant",

  menu_open: "Open the menu",
  sidebar_show: "Show the sidebar",
  sidebar_hide: "Hide the sidebar",
  sidebar_show_short: "Show menu",
  sidebar_hide_short: "Hide menu",
  new_conversation: "New conversation",
  attached_file: "Attached file",
  backend_down_1: "No connection to the MedAI server. Start the backend (",
  backend_down_2: ") and try again.",
  claude_unconfigured_1: "The Claude API is not configured. Set",
  claude_unconfigured_2: "in the",
  claude_unconfigured_3: "file and restart the server.",
  welcome_heading: "How can I help?",
  welcome_text:
    "Hello! I am MedAI, your AI medical assistant. You can ask me about symptoms and conditions, attach an X-ray for an experimental AI analysis, or attach a medical document for me to explain.",
  suggestion_1: "What are the symptoms of pneumonia?",
  suggestion_2: "I have had a headache for a few days.",
  suggestion_3: "What does high blood pressure mean?",
  suggestion_4: "I want to analyse an X-ray image.",
  xray_unavailable_incompatible:
    "The configured model is not a medical model, so the X-ray Analyzer is unavailable.",
  xray_unavailable_missing:
    "The X-ray Analyzer model is not configured on the server, so real X-ray analysis is unavailable.",
  settings: "Settings",
  scroll_to_latest: "Jump to the latest message",
  footer_disclaimer:
    "MedAI gives general information and does not diagnose. It does not replace a consultation with a doctor.",
  footer_emergency_1: "In an emergency, call",
  footer_emergency_2: ".",
  unexpected_error: "An unexpected error occurred.",

  sidebar_label: "Sidebar",
  menu_close: "Close the menu",
  history_heading: "Conversation history",
  history_empty: "No conversations yet. The history is kept only in this browser tab.",
  delete_conversation: "Delete conversation",
  delete_conversation_named: "Delete the conversation “{title}”",
  resize_sidebar: "Resize the sidebar",
  resize_hint: "Drag to resize, double-click to reset",

  content_xray: "X-ray",
  content_scan: "Scan",
  content_document: "Document",
  content_photo: "Photo",
  file_too_large: "The file is over 10 MB.",
  upload_failed: "The upload failed.",
  drop_here: "Drop the file here",
  remove_file: "Remove {name}",
  attach: "Attach an image or document",
  attach_hint: "Attach an X-ray image or a medical document (PNG, JPEG, WEBP, BMP, PDF)",
  composer_placeholder: "Describe a symptom or ask a question...",
  composer_label: "Message to MedAI",
  stop_reply: "Stop the reply",
  stop: "Stop",
  send: "Send",
  send_hint: "Send (Ctrl+Enter)",

  typing: "MedAI is typing",
  emergency_title: "Possible emergency",
  emergency_1: "If the condition is severe or getting worse, call",
  emergency_2: " immediately. Do not wait for MedAI's reply.",
  pdf_document: "PDF document",
  pdf_page_one: "1 page",
  pdf_pages: "{count} pages",
  attached_image_alt: "Attached image: {name}",
  reply_stopped: "The reply was stopped.",
  retry: "Try again",

  consent_title: "Before you start",
  consent_description: "Please read how MedAI handles health information.",
  consent_1_title: "Not a doctor and makes no diagnosis",
  consent_1_text:
    "MedAI gives general educational information. It does not replace an examination, a diagnosis or treatment by a medical professional.",
  consent_2_title: "Messages are processed by an external AI service",
  consent_2_text:
    "The text you send is passed to Anthropic's Claude API to generate a reply. Do not enter names, a national ID number (ЕГН) or other details that could identify you.",
  consent_3_title: "X-rays are analysed locally",
  consent_3_text:
    "X-ray images are processed only on the MedAI server. Only the results of the analysis are sent to Claude, never the image itself.",
  consent_4_title: "Medical documents are sent to Claude",
  consent_4_text:
    "If you ask for a document (discharge summary, test results, prescription) to be read, the file itself is sent to the Claude API with everything on it, including name and ЕГН. The name, ЕГН and address are not extracted into the conversation. If you do not want to send them, cover them before taking the picture.",
  consent_5_title: "Doctor search on Superdoc",
  consent_5_text:
    "If you ask us to find a specialist, only the specialty and the town are sent to superdoc.bg. The results are not a recommendation by MedAI.",
  consent_6_title: "Medication reference on Framar",
  consent_6_text:
    "When a medicine comes up, only its name is sent to framar.bg. The information is for reference and does not replace a doctor or a pharmacist.",
  consent_7_title: "Temporary storage",
  consent_7_text:
    "The history is kept only in this browser tab and disappears when it is closed. Uploaded images are deleted from the server automatically.",
  consent_emergency_lead: "In an emergency",
  consent_emergency_body:
    "(severe chest pain, difficulty breathing, signs of a stroke) call",
  consent_emergency_after: " immediately.",
  consent_prototype:
    "This is a prototype. The application is not a medical device and is not certified for clinical use.",
  consent_checkbox:
    "I understand the above and agree that my messages, and the documents I ask to have read, are sent for processing to the Claude API (Anthropic).",
  consent_decline: "Not now",
  consent_accept: "I agree, continue",

  settings_description: "System status, language and theme, view and privacy.",
  section_status: "Status",
  status_server: "Server",
  status_no_connection: "No connection",
  status_running: "Running",
  status_checking: "Checking...",
  status_claude: "Claude API",
  status_missing_key: "API key missing",
  status_no_data: "No data",
  status_xray: "X-ray Analyzer",
  status_triage: "Image recognition",
  yolo_ready: "Medical model: available",
  yolo_not_configured: "Model not configured",
  yolo_weights_missing: "Weights file not found",
  yolo_incompatible: "Weights are not a medical model",
  yolo_error: "Error loading the model",
  triage_ready: "Local model: available",
  triage_loading: "Loading...",
  triage_disabled: "Disabled on the server",
  triage_not_installed: "Library not installed",
  triage_error: "Error loading the model",
  model_classes: "Model classes: {classes}",
  section_appearance: "Language and theme",
  language: "Language",
  language_hint: "The language of the interface and of MedAI's replies.",
  theme: "Theme",
  theme_hint: "All themes are dark; they differ in the warmth of their colours.",
  theme_graphite: "Graphite",
  theme_graphite_hint: "Neutral black, blue accent",
  theme_ember: "Ember",
  theme_ember_hint: "Warm brown-black, copper accent",
  theme_dusk: "Dusk",
  theme_dusk_hint: "Deep plum, rose accent",
  section_view: "View",
  show_tools_title: "Show the tools at work",
  show_tools_text:
    "Cards with the status and raw data of every check: X-ray, medicines, doctors, documents. Off: you see only MedAI's reply.",
  section_privacy: "Privacy",
  privacy_text:
    "The history is kept only in this browser tab (sessionStorage). Messages are processed by the Claude API. X-ray images are analysed locally on the server. A document you ask to have read is sent to the Claude API. Uploaded files are deleted automatically. A doctor search sends only the specialty and the town to superdoc.bg, and a medication lookup sends only the medicine's name to framar.bg.",
  confirm_delete: "Delete all conversations and uploaded images? This cannot be undone.",
  confirm_delete_yes: "Yes, delete everything",
  cancel: "Cancel",
  delete_history: "Delete the whole history",
  revoke_consent: "Withdraw consent to processing",
  consent_not_given: "Consent not given",

  search_label: "Search:",
  search_in: "in",
  search_all_bulgaria: "across Bulgaria",
  sponsored: "Sponsored",
  reviews_count: "({count} reviews)",
  earliest_slot: "Earliest slot: {when}",
  book: "Book",
  doctor_profile: "{name}'s profile on Superdoc",
  all_results_superdoc: "See all results on Superdoc",
  doctors_disclaimer:
    "Data comes from the public pages of superdoc.bg at the time of the search. Ratings are by Superdoc users and do not measure the quality of care. MedAI is not affiliated with Superdoc and does not recommend any particular doctor.",
  initials_fallback: "D",

  readable_good: "Legible",
  readable_partial: "Partly legible",
  readable_poor: "Hard to read",
  med_ctx_prescribed: "Prescribed",
  med_ctx_during_stay: "During the stay",
  med_ctx_previous: "Previous therapy",
  flag_high: "Above range",
  flag_low: "Below range",
  flag_abnormal: "Out of range",
  flag_normal: "Normal",
  flag_unknown: "No range given",
  medical_document: "Medical document",
  diagnoses: "Diagnoses",
  medications: "Medicines",
  tests: "Tests",
  recommendations: "Recommendations",
  reference_range: "range",
  unreadable_parts: "Unreadable parts: {parts}.",
  doc_sent_to_claude:
    "To be read, the file was sent to the Claude API (Anthropic) with everything visible on it. The name, ЕГН and address are not extracted and are not shown here.",
  doc_not_sent: "The file was not sent to be read.",
  doc_accuracy:
    "The reading is automatic and may contain mistakes: check doses and values against the original. This is not a medical conclusion.",

  kind_product: "Product leaflet",
  kind_active_ingredient: "Active ingredient",
  kind_reference: "Reference",
  searched_for: "· searched for: “{query}”",
  med_unavailable: "Framar could not be reached for this medicine.",
  med_not_found: "Not found on Framar.",
  source: "Source",
  med_in_framar: "{name} on Framar",
  interactions_heading: "Interaction check",
  ix_major_label: "Highly significant",
  ix_major_text: "Framar describes a highly clinically significant interaction.",
  ix_moderate_label: "Moderately significant",
  ix_moderate_text: "Framar describes a moderately clinically significant interaction.",
  ix_minor_label: "Minor",
  ix_documented_label: "Documented",
  ix_documented_text: "Framar describes an interaction between the two.",
  ix_same_label: "Same active ingredient",
  ix_same_text: "Both products contain the same active ingredient, so the doses add up.",
  ix_none_label: "None listed",
  ix_none_text: "Framar lists no interaction. This does not mean the combination is safe.",
  ix_unchecked_label: "Not checked",
  ix_unchecked_text: "The interaction could not be checked on Framar.",
  ix_also_same: "Both products also contain the same active ingredient.",
  view_in_framar: "View on Framar",
  medications_disclaimer:
    "Data comes from the public pages of framar.bg (leaflets and the interaction reference) at the time of the lookup and is for reference only. The absence of a listed interaction does not prove the combination is safe. Consult a doctor or pharmacist before taking anything. MedAI is not affiliated with Framar.",

  tool_using: "MedAI is using a tool",
  tool_running: "Running...",
  tool_finished: "The tool has finished.",

  image_unavailable: "The image is no longer available (temporary files are deleted automatically).",
  image_loading: "Loading the image",
  image_enlarge: "Enlarge: {alt}",
  image_enlarged: "Enlarged view of the image",

  close: "Close",

  api_unreachable: "No connection to the MedAI server. Make sure the backend is running.",
  api_server_error: "Server error ({status}).",
  api_empty_stream: "The server returned no reply.",
  api_stream_interrupted: "The connection to the server was lost during the reply.",
};

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { bg, en };

export type Params = Record<string, string | number>;

export function translate(language: Language, key: MessageKey, params?: Params): string {
  const text = MESSAGES[language][key] ?? MESSAGES.bg[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// --- outside React -----------------------------------------------------------

let currentLanguage: Language = DEFAULT_LANGUAGE;

/** Called by the app whenever the language setting is loaded or changed. */
export function setCurrentLanguage(language: Language) {
  currentLanguage = language;
}

export function getCurrentLanguage(): Language {
  return currentLanguage;
}

/** For modules without access to the React tree (api.ts). */
export function tr(key: MessageKey, params?: Params): string {
  return translate(currentLanguage, key, params);
}

// --- React -------------------------------------------------------------------

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export type Translate = (key: MessageKey, params?: Params) => string;

export function useT(): Translate {
  const language = useContext(LanguageContext);
  return useCallback((key: MessageKey, params?: Params) => translate(language, key, params), [language]);
}
