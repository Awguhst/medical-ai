# MedAI Bulgaria (МедAI)

A Bulgarian AI medical information chatbot. One chat interface, powered by the
Claude API, that can call a **locally hosted YOLO model as a tool** to analyse
chest X-ray images the user attaches to the conversation.

> **Prototype.** MedAI gives general, educational health information. It is not
> a medical device, does not diagnose, and is not certified for clinical use.
> In an emergency in Bulgaria call **112**.

## How it works

```text
Browser (Next.js)  ──►  FastAPI backend  ──►  Claude API (text + tool calls)
                              │   ▲
            tool call         ▼   │  structured result
                        analyze_xray ──► local YOLO model (image never leaves the server)
```

* The user chats in Bulgarian and may attach an X-ray or a medical document.
  There is no separate
  "analyse" button or page.
* Claude receives the text plus **attachment metadata only** (an `image_id`,
  file name, size) — never the file itself. The one exception is the document
  reader, which sends a document the user asks to be read in a separate
  request (see "Reading medical documents").
* On upload, a local zero-shot CLIP vision transformer labels the image as
  `xray`, `scan`, `document` or `photo`. The label travels with the attachment
  metadata; for an X-ray the backend runs `analyze_xray` itself before Claude
  answers, so the user does not have to ask, and for a document the label
  tells Claude to call the reader.
* Claude calls `analyze_xray` with the `image_id`. The backend validates the
  call, runs YOLO locally, draws the boxes, returns the structured result to
  Claude as a `tool_result`, and streams the tool activity and the annotated
  image into the chat.
* Claude explains the result in Bulgarian, including its limitations.

## Requirements

* Python 3.10 – 3.12 (PyTorch/Ultralytics wheels; 3.12 was used for development)
* Node.js 20+
* An Anthropic API key
* Optional: custom chest X-ray YOLO weights (see [models/README.md](models/README.md))
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

If the backend runs elsewhere, tell the frontend where: `API_URL` in the
environment of the Next.js server (read at request time and handed to the
browser) or `NEXT_PUBLIC_API_URL` in `frontend/.env.local` (baked in at build
time). Then add the frontend's origin to `FRONTEND_ORIGINS` in `.env`.

## Using it

1. Accept the consent dialog (required before anything is sent to Claude).
2. Ask a question, or use one of the suggested prompts.
3. Attach an X-ray with the paperclip (PNG, JPEG, WEBP or BMP, up to 10 MB;
   drag-and-drop and paste also work). The server recognises it as an X-ray
   and the assistant runs the analysis straight away; a short note such as
   „това е на гърдите ми“ is enough.

### Without YOLO weights

The app works without a model. An analysis request then produces the tool
status `model_not_configured`, and the assistant explains that no analysis was
performed.

To try the full interface anyway, enable **Настройки → Демо режим**. Demo
results are random placeholders and are labelled as a simulation in the tool
output, on the annotated image and in the chat. Demo mode is unavailable when
a real model is configured and can be turned off on the server
(`YOLO_ALLOW_DEMO_MODE=false`).

### With YOLO weights

Put custom chest X-ray **detection** weights in `models/`, set
`YOLO_WEIGHTS_PATH`, restart the backend. Stock COCO weights (`yolov8n.pt`
etc.) are detected by their class names and rejected as `model_incompatible`.
Details: [models/README.md](models/README.md).

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

No GPU is needed: both models run on the CPU (about 0.3 s per X-ray on a
desktop core, one to two seconds on a small cloud vCPU) and the backend uses
roughly 1.5 GB of memory with both models loaded. That rules out free tiers
but fits Railway's Hobby plan.

### Images

```bash
# Backend (build context = repository root; both models are baked in)
docker build -t medai-backend .
docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... medai-backend

# Frontend (backend address is a runtime setting; the image is built once)
docker build -t medai-frontend frontend
docker run --rm -p 3000:3000 -e API_URL=http://localhost:8000 medai-frontend
```

Or both at once, with [docker-compose.yml](docker-compose.yml) reading the
same `.env` the backend uses outside Docker:

```bash
docker compose up --build -d      # backend on :8000, frontend on :3000
docker compose down
```

For a server other than your own machine, set `API_URL` in `.env` to the
backend URL the browser will reach, and put the frontend's URL in
`FRONTEND_ORIGINS`. Both are runtime settings: `docker compose up -d` after a
change restarts the containers without rebuilding. If ports 8000 or 3000 are
taken, `BACKEND_PORT` and `FRONTEND_PORT` move the host ports (adjust those
two URLs to match). Railway does not use this file; it builds the two
Dockerfiles itself.

What the backend build does, and why:

* installs the CPU build of PyTorch first, so the multi-gigabyte CUDA wheels
  never enter the image;
* downloads the X-ray Analyzer weights from the Hugging Face repository named
  in [models/README.md](models/README.md) and verifies their SHA-256, so the
  image carries exactly the checked file without committing a binary to git
  (`YOLO_WEIGHTS_URL` and `YOLO_WEIGHTS_SHA256` are build arguments; an empty
  URL builds without a model, demo mode only);
* downloads the CLIP triage model into the image, because a Railway container's
  filesystem is wiped on every deploy and a fresh instance must not fetch
  600 MB before it can label an upload;
* runs one uvicorn worker as an unprivileged user and binds to `PORT`.

### Railway

The project is described in [.railway/railway.ts](.railway/railway.ts)
(Railway's infrastructure as code; `railway.json` is being retired on
2026-12-01). It defines two services from this repository:

| Service | Build | Root directory | Health check |
|---|---|---|---|
| `backend` | `Dockerfile` at the repository root | empty | `GET /api/health` |
| `frontend` | `frontend/Dockerfile` | `frontend` | `GET /` |

Steps, on the Hobby plan or above:

1. Push this repository to GitHub and create an empty Railway project.
2. Install the [Railway CLI](https://docs.railway.com/guides/cli) (5.42.1 or
   newer), then from the repository root:

   ```bash
   npm install                     # the `railway` SDK that .railway/railway.ts imports
   railway login
   railway link                    # choose the project and environment
   railway config plan             # shows what will be created
   railway config apply
   ```

3. Set `GITHUB_REPO` at the top of the IaC file to `owner/medical-ai` before
   the apply, or connect the repository to both services in the dashboard
   afterwards. Then click **Generate Domain** on each service. The two services find each other
   through those domains: the frontend's `API_URL` and the backend's
   `FRONTEND_ORIGINS` (CORS) are reference variables that resolve to them, and
   both are read at runtime, so a domain change needs no rebuild. Add any
   custom domain you attach later to `FRONTEND_ORIGINS`.
4. Set `ANTHROPIC_API_KEY` on the backend service (dashboard or
   `railway variables set`). The IaC file marks it as preserved so an apply
   never overwrites or removes it.
5. Trigger a deploy. The first backend build downloads about 1 GB (PyTorch,
   weights, CLIP) and takes a few minutes; the health check passes as soon as
   uvicorn is up, while the triage model finishes warming up in the background.

Notes:

* Keep one replica and leave app sleeping off: uploaded images live in the
  process that received them, and a cold start reloads both models.
* Expect roughly 1.5 to 2 GB of memory for the backend. Setting
  `IMAGE_TRIAGE_ENABLED=false` roughly halves that, at the price of the
  automatic X-ray recognition on upload.
* Uploads are stored in the container's temporary directory and deleted after
  `IMAGE_TTL_MINUTES`; nothing needs a volume.
* Before a public deployment, read the Superdoc and Framar notes above:
  the prototype's scraping needs those sites' agreement.

## Checks

```bash
# Backend: 114 offline checks (no network, key or weights needed)
cd backend && python smoke_test.py

# Frontend
cd frontend && npm run typecheck && npm run build
```

`smoke_test.py` covers upload validation, session isolation, path traversal,
the tool registry, the YOLO guard rails, the document reader (PDF validation,
scripted vision replies, masking of identifiers, failure handling), the
Superdoc and Framar tools (against HTML fixtures: name matching, leaflet extraction, pair-wise interaction checks,
URL guards, failure handling), and the tool-use loop (message and
`tool_result` ordering, unregistered tools, the iteration limit) using a
scripted stand-in for the Anthropic client.

## API

All endpoints except `/api/health` require an `X-Session-Id` header (a random
id the browser keeps in `sessionStorage`).

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | One user turn. Body: `conversation_id`, `consent`, `demo_mode`, `history`, `message {text, attachment_ids}`. Response: Server-Sent Events — `text_delta`, `tool_start`, `tool_end`, `emergency`, `notice`, `error`, `done`. |
| `POST /api/upload` | Multipart `file` (image or PDF) + `conversation_id`. Returns a temporary `image_id`. |
| `GET /api/images/{image_id}` | Original or annotated image, only for the session that owns it. |
| `DELETE /api/conversations/{id}` | Delete a conversation's images and tool results. |
| `DELETE /api/session` | Delete everything stored for the session. |
| `GET /api/health` | Status; whether Claude, YOLO and the image triage model are configured. |

## Project structure

```text
├── backend/
│   ├── main.py                     FastAPI app, CORS, health, cleanup task
│   ├── config.py                   Settings from .env
│   ├── routers/                    chat.py (SSE), uploads.py, deps.py
│   ├── services/
│   │   ├── claude_service.py       Messages API streaming + tool-use loop
│   │   ├── tool_registry.py        Tool registry: analyze_xray, read_document, find_doctors, lookup_medication
│   │   ├── document_service.py     Reads an uploaded medical document with Claude vision
│   │   ├── framar_service.py       Medication leaflets and interactions from framar.bg
│   │   ├── superdoc_service.py     Doctor search on superdoc.bg listing pages
│   │   ├── yolo_service.py         Weights checks, inference, annotation, demo
│   │   ├── image_triage_service.py Local CLIP triage: xray / scan / document / photo
│   │   ├── image_service.py        Validated, session-scoped temp image store
│   │   └── safety_service.py       Input cleaning, emergency wording, log refs
│   ├── prompts/medical_system_prompt.py
│   ├── models/schemas.py           Pydantic schemas
│   ├── prefetch_models.py          Downloads the CLIP triage model (used by the Dockerfile)
│   ├── smoke_test.py
│   └── requirements.txt
├── frontend/
│   ├── app/                        layout.tsx, page.tsx, globals.css
│   ├── components/                 ChatInterface, ChatMessage, ChatInput, Sidebar,
│   │                               ImageAttachment, ToolResult, ConsentDialog,
│   │                               SettingsDialog, ui/ (shadcn-style primitives)
│   ├── lib/                        api.ts, storage.ts, types.ts, utils.ts
│   └── Dockerfile                  Next.js standalone image
├── models/                         YOLO weights go here (README.md inside); triage/ is the CLIP cache
├── .railway/railway.ts             Railway infrastructure as code (two services)
├── Dockerfile                      Backend image (context: repository root, models baked in)
├── docker-compose.yml              Both services on one machine (not used by Railway)
├── package.json                    Root tooling only: the `railway` SDK for .railway/railway.ts
└── .env.example
```

## Adding another tool

Tools live in `backend/services/tool_registry.py`. Write an async handler and
register it; the chat loop and the frontend's tool card need no changes.

```python
class LookupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term: str

async def _lookup(parsed: LookupInput, ctx: ToolContext) -> ToolOutcome:
    return ToolOutcome(payload={"status": "success", ...}, ui={"status": "success", "message": "Готово."})

registry.register(ToolSpec(
    name="lookup_term", description="...",
    input_schema={"type": "object", "properties": {"term": {"type": "string"}},
                  "required": ["term"], "additionalProperties": False},
    input_model=LookupInput, handler=_lookup,
    ui_label="Медицински речник", ui_running_text="Търсене...",
))
```

## Safety and privacy design

* **Claude can only call registered tools.** Tool names are checked against the
  registry and inputs validated with Pydantic; there is no code-execution or
  shell tool. Tool rounds are capped (`MAX_TOOL_ITERATIONS`), after which the
  request is sent with `tool_choice: none`. Each tool call has a timeout.
* **No model-supplied paths.** `analyze_xray` accepts only an opaque
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
  is forwarded to Claude. Messages are processed by Anthropic's API. X-ray
  images are not sent there. A document is sent there only when the user asks
  for it to be read; its name, ЕГН and address are kept out of the result.
* **History** lives in the browser's `sessionStorage` and can be deleted per
  conversation or entirely from Настройки.
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
