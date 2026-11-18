# MedAI Bulgaria (МедAI)

A Bulgarian AI medical information chatbot. One chat interface, powered by the
Claude API, that can look at an X-ray, a scan or a photo the user attaches
through a **separate Claude vision reader used as a tool**, and read medical
documents the same way.

> **Prototype.** MedAI gives general, educational health information. It is not
> a medical device, does not diagnose, and is not certified for clinical use.
> In an emergency in Bulgaria call **112**.

## How it works

```text
Browser (Next.js)  ──►  FastAPI backend  ──►  Claude API (text + tool calls)
                              │   ▲
            tool call         ▼   │  structured result
                        analyze_image ──► Claude vision (a separate request with the picture)
```

* The user chats in Bulgarian or English (a setting; the assistant replies in
  the chosen language) and may attach a medical image or a medical document.
  There is no separate "analyse" button or page.
* The chat model receives the text plus **attachment metadata only** (an
  `image_id`, file name, size) — never the file itself. The two tools that
  look at a file, `analyze_image` and `read_document`, each send it in a
  separate request whose only job is to turn it into structured data.
* On upload, a local zero-shot CLIP vision transformer labels the image as
  `xray`, `scan`, `document` or `photo`. The label travels with the attachment
  metadata; for an X-ray or a scan the backend runs `analyze_image` itself
  before Claude answers, so the user does not have to ask, and for a document
  the label tells Claude to call the document reader.
* `analyze_image` sends the picture, with the user's words as context, to a
  Claude vision request with its own prompt and a strict schema. It returns a
  description: the kind of image and body region, its quality, each finding
  with its place on the picture, how much it matters and how sure the reader
  is, an impression, the limitations and what the radiologist's report would
  add. The backend validates the call, masks identifiers, returns the result
  to the chat model as a `tool_result`, and streams the tool activity into
  the chat.
* The chat model puts the result into words in the interface language, in the
  first person, with the care each finding's confidence calls for, and says
  that the radiologist's report has to confirm it. It is a description by an
  AI, not a validated detector and not a diagnosis.

## Requirements

* Python 3.10 – 3.12 (PyTorch wheels; 3.12 was used for development)
* Node.js 20+
* An Anthropic API key
* About 600 MB of disk and an internet connection on first start for the image
  triage model, downloaded automatically (set `IMAGE_TRIAGE_ENABLED=false` to skip it)

## Setup

### 1. Configuration

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env` and set at least `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` is
optional (default: `claude-opus-5-5`). The key is read only by the backend.

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

The first install downloads PyTorch (several hundred MB).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>.

The dev server talks to the API on <http://localhost:8000>. If the backend
runs elsewhere, set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` and add the
frontend's origin to `FRONTEND_ORIGINS` in `.env`. In the Docker image the
backend serves the frontend itself, so neither setting is needed there.

## Using it

1. Accept the consent dialog (required before anything is sent to Claude).
2. Ask a question, or use one of the suggested prompts.
3. Attach an X-ray, a scan or a photo with the paperclip (PNG, JPEG, WEBP or
   BMP, up to 10 MB; drag-and-drop and paste also work). The server recognises
   an X-ray or a scan and has it looked at straight away; a short note such as
   „това е на гърдите ми“ is enough.
4. The pencil under one of your messages (on hover with a mouse, always on a
   touch screen) rewrites it. The rewritten message is sent again as a new
   branch of the conversation; the earlier version and its reply stay
   available through the 1/2 arrows under the message. **Regenerate** under
   the last reply does the same for the answer.
5. **Настройки / Settings** holds the interface language (Bulgarian or
   English; the assistant answers in it, and so do the API's messages and
   tool cards) and the colour theme: **Graphite** (neutral black, blue
   accent), **Ember** (warm brown-black, copper accent) or **Dusk** (deep
   plum, rose accent), all dark. Both are kept in `localStorage`, apply
   before the first paint, and carry no health data.

### Looking at a medical image

Attach an X-ray, a CT or MRI slice, an ultrasound, a mammogram or a photo of
skin, a wound or an eye. For an X-ray or a scan the backend calls
`analyze_image` itself at upload; for a photo the assistant calls it. The
picture goes to Claude in a separate request (the consent dialog says so) and
comes back as a structured description, which the assistant puts into a
doctor's words. There are no boxes and no scores: it is a description by an
AI vision model, not a validated detector, and the assistant says every time
that the radiologist's report or an examination has to confirm it. Disable
the tool with `IMAGE_READER_ENABLED=false`.

### Finding a doctor (Superdoc)

Ask for a specialist, e.g. „Намери ми пулмолог в Пловдив“. Claude calls the
`find_doctors` tool, which reads the public listing pages of
[superdoc.bg](https://superdoc.bg) and shows a card with names, Superdoc user
ratings, the earliest slot shown and a booking link to each profile.

* Superdoc has **no public API**; the tool parses its HTML listing pages
  (`/lekari/{specialty}/{city}`). A redesign of the site can break the parser,
  in which case the tool reports `no_results` or `source_unavailable`.
  Superdoc's `robots.txt` allows these pages and its terms of use do not
  mention automated access, but this is not an agreement with Superdoc: check
  with them before any real deployment.
* Only the specialty, town and sort order are sent to Superdoc.
* The request URL is built from Superdoc's own specialty and town indexes;
  model-supplied text is matched against that catalog and never put in a URL.
* Results are the first page only, sponsored listings are marked, and ratings
  are user reviews. MedAI cannot book appointments.
* Results are cached for 10 minutes. Disable the tool with
  `SUPERDOC_ENABLED=false`.

### Reading medical documents

Attach a photo, scan or PDF of an епикриза, амбулаторен лист, lab results,
prescription or referral and ask „Какво пише тук?“. Claude calls the
`read_document` tool and the chat shows a card with the document type, the
diagnoses with their ICD-10 codes, the medicines with doses, the test results
with the document's own reference ranges, and the recommendations. The
assistant then explains it in plain Bulgarian and can pass the listed medicines
to the Framar check.

* **The file leaves the server.** Unlike X-ray analysis, reading a document
  sends the page itself to the Claude API, including whatever is on it (name,
  ЕГН, address). The consent dialog says so, the result card repeats it, and
  nothing is sent until the model calls the tool for a file the user attached.
* **How it is read.** The tool makes a second, separate Claude request that
  carries only the file and one strict-schema tool. The chat model never gets
  the file, only the structured result, which is kept server-side like other
  tool results.
* **Personal data.** The reader is instructed not to copy the patient's name,
  ЕГН/ЛНЧ, address, phone or doctors' names. As a second line, e-mails, phone
  numbers and digit runs of nine or more are masked in everything it returns.
  This limits what enters the conversation; it does not change what Anthropic
  receives in the image.
* **Accuracy.** A vision model can misread a digit. The reader is told to omit
  what it cannot read and list it as unreadable, test flags come only from the
  ranges printed on the page, and the assistant is told to say „според
  документа“ and to ask the user to check doses and values against the
  original. It explains the treating doctors' decisions and does not overrule
  them.
* **Document text is data.** Instructions written inside a document are not
  followed, by the reader or by the chat model.
* **Files.** PNG, JPEG, WEBP, BMP, or a PDF of up to `MAX_PDF_PAGES` (10)
  pages that is not password-protected. A PDF is validated with `pypdf`, kept
  as a temporary file like the images, and never served back to the browser.
* Costs one extra Claude request per document. Disable the tool with
  `DOCUMENT_READER_ENABLED=false`.

### Medicines (Framar)

Whenever the assistant is about to advise on a medicine (dose, how to take it,
side effects, contraindications, combining it with something else), Claude
first calls the `lookup_medication` tool, which reads
[framar.bg](https://www.framar.bg). Try „Мога ли да пия ибупрофен с варфарин?“
or „Как се пие Нурофен?“.

* **What is read.** Framar's search, then either the product page with its
  patient leaflet (`apteka.framar.bg`) or the active-ingredient page
  (`medpedia.framar.bg`), and the interaction checker
  (`vzaimodeistvie.framar.bg`). The tool returns the matched entry, active
  ingredients with ATC codes, capped extracts (uses, contraindications and
  warnings, other medicines, dosage, side effects), and the source links.
* **Several medicines.** Up to four per call. Every pair is looked up in
  Framar's interaction lists, in both directions and by active ingredient, so
  a brand product is matched through what it contains. A pair comes back as
  `documented` (with Framar's severity and text), `none_listed` or
  `not_checked`, and two products with the same active ingredient are
  flagged. `none_listed` is never presented as "safe": the result and the
  system prompt both say so.
* **Names.** Bulgarian or English, brand or active ingredient. Latin names
  are transliterated for matching; the model is told to prefer the Bulgarian
  name of the active ingredient. A brand with several strengths resolves to
  one product, which is named in the answer; the others are listed.
* **What is sent.** Only the medicine name, as a search term.
* **Limits to know about.**
  * Framar has **no public API**; this parses HTML and a redesign can break
    it. The tool then reports `not_found` or `source_unavailable`, and the
    assistant is instructed not to fall back on doses from memory.
  * `robots.txt` allows these pages, but Framar's
    [terms](https://www.framar.bg/help?id=681) state that its content is
    copyrighted and may not be copied, reproduced or redistributed without
    Framar's prior permission, nor used commercially. The tool keeps to
    on-demand lookups, short extracts that the model summarises with a link
    back, a 24-hour in-memory cache and no storage on disk. That is a
    prototype's good-faith reading, not permission: **get Framar's agreement
    before any real deployment.**
  * Framar itself says its information is for reference and does not replace
    a doctor or pharmacist. Extracts are truncated, some active-ingredient
    pages are thin, and the interaction list is not guaranteed complete.
* Disable the tool with `FRAMAR_ENABLED=false`.

## Deploying with Docker and Railway

One image, one process, one address. The Dockerfile at the repository root
builds the Next.js frontend as static files and bakes them into the Python
image, where FastAPI serves them next to the API. There is no CORS to
configure and no frontend URL to set.

No GPU is needed: both models run on the CPU (about 0.3 s per X-ray on a
desktop core, one to two seconds on a small cloud vCPU) and the process uses
roughly 1.5 GB of memory with both models loaded. That rules out free tiers
but fits Railway's Hobby plan.

### Docker

```bash
docker build -t medai .
docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... medai

# or, with the settings read from .env:
docker compose up --build -d
```

Open <http://localhost:8000>. If 8000 is taken, `PORT_ON_HOST=8080 docker compose up -d`
moves the host port.

What the build does, and why:

* builds the frontend with `next build` (static export) and copies the result
  into the image, where the backend serves it from `/`;
* installs the CPU build of PyTorch first, so the multi-gigabyte CUDA wheels
  never enter the image;
* downloads the CLIP triage model into the image, because a Railway container's
  filesystem is wiped on every deploy and a fresh instance must not fetch
  600 MB before it can label an upload;
* runs one uvicorn worker as an unprivileged user and binds to `PORT`.

### Railway

Hobby plan or above. Everything happens in the dashboard:

1. **New project → Deploy from GitHub repo**, pick this repository and leave
   the root directory empty. Railway finds the Dockerfile and builds it. The
   first build downloads about 1 GB and takes several minutes.
2. **Variables**: add `ANTHROPIC_API_KEY`.
3. **Settings → Networking → Generate Domain**. Open the domain: that is the
   app. `/api/health` on the same domain shows whether the key and the
   triage model are in place.
4. Recommended, **Settings → Deploy**: Healthcheck Path `/api/health`,
   Serverless (app sleeping) off, one replica, restart on failure.

[.railway/railway.ts](.railway/railway.ts) sets step 4 for you through
Railway's infrastructure as code (`railway.json` is being retired on
2026-12-01): `npm install`, `railway login`, `railway link`,
`railway config plan`, `railway config apply`. `SERVICE_NAME` in that file
must match the service's name in Railway.

Notes:

* Keep one replica and leave app sleeping off: uploaded images live in the
  process that received them, and a cold start reloads the triage model.
* Expect roughly 1.5 to 2 GB of memory. Setting `IMAGE_TRIAGE_ENABLED=false`
  roughly halves that, at the price of the automatic X-ray recognition on
  upload.
* Uploads are stored in the container's temporary directory and deleted after
  `IMAGE_TTL_MINUTES`; nothing needs a volume.
* Before a public deployment, read the Superdoc and Framar notes above:
  the prototype's scraping needs those sites' agreement.

## Checks

```bash
# Backend: 140 offline checks (no network and no key needed)
cd backend && python smoke_test.py

# Frontend
cd frontend && npm run typecheck && npm run build
```

`smoke_test.py` covers upload validation, session isolation, path traversal,
the interface language (`Accept-Language` on errors, tool cards and the system prompt),
the tool registry, the image reader (scripted vision replies, context and
language, masking of identifiers, failure handling), the document reader (PDF validation,
scripted vision replies, masking of identifiers, failure handling), the
Superdoc and Framar tools (against HTML fixtures: name matching, leaflet extraction, pair-wise interaction checks,
URL guards, failure handling), and the tool-use loop (message and
`tool_result` ordering, unregistered tools, the iteration limit) using a
scripted stand-in for the Anthropic client.

## API

All endpoints except `/api/health` require an `X-Session-Id` header (a random
id the browser keeps in `sessionStorage`). Every endpoint also honours
`Accept-Language` (`bg`, the default, or `en`): it selects the language of
error messages and of the tool names and status lines in the chat events,
and for `POST /api/chat` adds a second system block that asks Claude to reply
in English (after the cache breakpoint, so the cached prompt is unchanged).
The frontend sends it with every request; see `backend/i18n.py`.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | One user turn. Body: `conversation_id`, `consent`, `history`, `message {text, attachment_ids}`. Response: Server-Sent Events — `text_delta`, `tool_start`, `tool_end`, `emergency`, `notice`, `error`, `done`. |
| `POST /api/upload` | Multipart `file` (image or PDF) + `conversation_id`. Returns a temporary `image_id`. |
| `GET /api/images/{image_id}` | The uploaded image, only for the session that owns it. |
| `DELETE /api/conversations/{id}` | Delete a conversation's images and tool results. |
| `DELETE /api/session` | Delete everything stored for the session. |
| `GET /api/health` | Status; whether Claude, the image reader and the image triage model are configured. |

## Project structure

```text
├── backend/
│   ├── main.py                     FastAPI app, CORS, health, cleanup task
│   ├── config.py                   Settings from .env
│   ├── i18n.py                     User-facing messages in Bulgarian and English (Accept-Language)
│   ├── routers/                    chat.py (SSE), uploads.py, deps.py
│   ├── services/
│   │   ├── claude_service.py       Messages API streaming + tool-use loop
│   │   ├── tool_registry.py        Tool registry: analyze_image, read_document, find_doctors, lookup_medication
│   │   ├── image_reader_service.py Describes an uploaded medical image with Claude vision
│   │   ├── document_service.py     Reads an uploaded medical document with Claude vision
│   │   ├── framar_service.py       Medication leaflets and interactions from framar.bg
│   │   ├── superdoc_service.py     Doctor search on superdoc.bg listing pages
│   │   ├── image_triage_service.py Local CLIP triage: xray / scan / document / photo
│   │   ├── image_service.py        Validated, session-scoped temp image store
│   │   └── safety_service.py       Input cleaning, emergency wording, log refs
│   ├── prompts/medical_system_prompt.py
│   ├── models/schemas.py           Pydantic schemas
│   ├── prefetch_models.py          Downloads the CLIP triage model (used by the Dockerfile)
│   ├── smoke_test.py
│   └── requirements.txt
├── frontend/
│   ├── app/                        layout.tsx, page.tsx, globals.css (the three themes)
│   ├── components/                 ChatInterface, ChatMessage, ChatInput, Sidebar,
│   │                               ImageAttachment, ToolResult, ConsentDialog,
│   │                               SettingsDialog, ui/ (shadcn-style primitives)
│   └── lib/                        api.ts, i18n.ts (UI strings), preferences.ts (language, themes),
│                                   storage.ts, types.ts, utils.ts
├── models/                         triage/ is the CLIP cache (README.md inside)
├── .railway/railway.ts             Railway infrastructure as code (one service)
├── Dockerfile                      The whole app in one image: frontend static export + API + models
├── docker-compose.yml              Runs that image with the settings from .env (not used by Railway)
├── package.json                    Root tooling only: the `railway` SDK for .railway/railway.ts
└── .env.example
```

## Adding another tool

Tools live in `backend/services/tool_registry.py`. Write an async handler and
register it; the chat loop and the frontend's tool card need no changes. The
tool's name and running text are given per interface language, and any other
text the user will see (the card's status line) goes into `backend/i18n.py`
and is looked up with `tr(ctx.language, key)`.

```python
class LookupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term: str

async def _lookup(parsed: LookupInput, ctx: ToolContext) -> ToolOutcome:
    return ToolOutcome(payload={"status": "success", ...},
                       ui={"status": "success", "message": tr(ctx.language, "lookup_term.success")})

registry.register(ToolSpec(
    name="lookup_term", description="...",
    input_schema={"type": "object", "properties": {"term": {"type": "string"}},
                  "required": ["term"], "additionalProperties": False},
    input_model=LookupInput, handler=_lookup,
    ui_label={"bg": "Медицински речник", "en": "Medical dictionary"},
    ui_running_text={"bg": "Търсене...", "en": "Searching..."},
))
```

## Safety and privacy design

* **Claude can only call registered tools.** Tool names are checked against the
  registry and inputs validated with Pydantic; there is no code-execution or
  shell tool. Tool rounds are capped (`MAX_TOOL_ITERATIONS`), after which the
  request is sent with `tool_choice: none`. Each tool call has a timeout.
* **No model-supplied paths.** `analyze_image` and `read_document` accept only an opaque
  `image_id`, which must belong to an upload from the same session and
  conversation. Files are stored under server-generated names.
* **Uploads are validated by content** (decoded with Pillow), limited in size
  and dimensions, and re-encoded to PNG, which strips metadata. PDFs must
  parse, be unencrypted and short; they are stored as uploaded.
* **Images are temporary**: kept in a private temp directory, expired after
  `IMAGE_TTL_MINUTES`, and removed on shutdown and on history deletion.
* **Tool results cannot be forged by the browser.** The client sends only
  result ids in its history; the server restores the content from its own
  store.
* **Consent** is required in the UI and enforced by the API before any message
  is forwarded to Claude. Messages are processed by Anthropic's API. A medical
  image is sent there only through `analyze_image`, in its own request, and a
  document only when the user asks for it to be read; names, ЕГН and addresses
  are kept out of both results.
* **History** lives in the browser's `sessionStorage` and can be deleted per
  conversation or entirely from Настройки. The interface language and the
  theme are the only preferences kept in `localStorage`; they carry no health
  data.
* **Logs** contain statuses and hashed references, not message text, file
  names or image data.
* **Emergency wording** in a message triggers an immediate 112 banner,
  independent of the model's answer.
* The X-ray check is a coarse heuristic (colour and contrast): it rejects
  images that are clearly not radiographs but cannot confirm that an image is
  a chest X-ray.

This prototype makes no claim of GDPR compliance or medical certification.
There is no user authentication or rate limiting; do not expose it to the
internet as is.

## Notes on the Claude integration

* Default model `claude-opus-5-5`; change with `ANTHROPIC_MODEL`.
* Responses are streamed. Thinking is left at the model's default (adaptive).
  `ANTHROPIC_EFFORT` optionally sets the effort level.
* For models that support it, the server-side **refusal fallback** beta is
  enabled, so that a health question wrongly declined by a safety classifier
  is retried on a fallback model. Disable with
  `ANTHROPIC_REFUSAL_FALLBACK=false`.
