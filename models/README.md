# Models

MedAI ships no medical detection model. Medical images are described by
Claude vision through the `analyze_image` tool (see
`backend/services/image_reader_service.py`), which needs nothing but the API
key. The only model in this folder is the cache of the image triage model,
downloaded automatically.

## Image triage model (downloaded automatically)

`triage/` is the Hugging Face cache for the zero-shot CLIP vision transformer
(`openai/clip-vit-base-patch32` by default, about 600 MB) that labels every
uploaded image as `xray`, `scan`, `document` or `photo` before Claude sees the
attachment metadata. For an X-ray or a scan the backend runs `analyze_image`
itself before Claude answers; a document goes to `read_document` instead.

* Downloaded on the first start (safetensors only; no pickled checkpoints are
  loaded) and run on the CPU. The picture does not leave the server for this
  step.
* The folder is created automatically, is safe to delete, and is not committed.
* Configured with the `IMAGE_TRIAGE_*` settings in `.env.example`;
  `IMAGE_TRIAGE_ENABLED=false` skips the download, and every upload is then
  labelled `unknown`, so the assistant decides from the message alone.
* `GET /api/health` reports `image_triage.status`: `ready`, `loading`,
  `disabled`, `not_installed` (the `transformers` package is missing) or `error`.
* `cd backend && python prefetch_models.py` warms the cache ahead of a first
  start; the Dockerfile does the same while building.

A `.pt` file or any other pickled checkpoint can execute code when loaded. Do
not put untrusted checkpoints here.
