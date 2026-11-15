# YOLO model weights

This folder holds the weights for the `analyze_xray` tool. It is empty by
default: **MedAI does not ship a medical model.**

## Currently installed (local only, not committed)

`medical_yolo.pt` — downloaded from the Hugging Face repo
[`jayanthapoojary1989/rsna-pneumonia-yolov8s`](https://huggingface.co/jayanthapoojary1989/rsna-pneumonia-yolov8s)
(file `pytorch_yolov8_model.pt`).

* YOLOv8s detector, **one class: `pneumonia`** (lung opacity), 640 px input,
  trained by its author on a subset of the RSNA Pneumonia Detection Challenge data.
* Author-reported validation metrics: precision 0.52, recall 0.63, mAP@0.5 0.54.
  That is a weak research model: it misses many opacities and raises false alarms.
* The repo states no licence and describes the model as "for research and
  educational purposes". The RSNA data has its own terms of use.
* SHA-256: `a514f8e1706dcb640198e84813372cd122c57d3fa47b993a9a7900d247dbae43`

A `.pt` checkpoint is a Python pickle and can execute code when loaded. This
file was checksum-verified and scanned with `picklescan` (no dangerous
imports; only `torch`, `ultralytics`, `collections`). Apply the same care to
any other checkpoint you install.

## What is required

A YOLO **detection** model (Ultralytics format, `.pt`) trained on **chest
X-ray** images, for example a model you trained yourself on a public
chest-radiograph dataset with bounding-box labels (VinDr-CXR, the RSNA
Pneumonia Detection Challenge data, NIH ChestX-ray14 box annotations, …).
Check the licence of any dataset or checkpoint before you use it.

1. Put the file here, e.g. `models/medical_yolo.pt`.
2. Point the backend at it in `.env`:

   ```env
   YOLO_WEIGHTS_PATH=./models/medical_yolo.pt
   ```

3. Restart the backend. `GET /api/health` and the app's **Настройки** dialog
   show whether the model was accepted.

Training a model, in outline:

```bash
yolo detect train data=chest_xray.yaml model=yolo11n.pt imgsz=640 epochs=100
# result: runs/detect/train/weights/best.pt  ->  copy to models/medical_yolo.pt
```

## What is rejected

* **General-purpose weights** such as `yolov8n.pt` / `yolo11n.pt` (COCO:
  person, car, dog, …). The backend inspects the class names and refuses them
  with status `model_incompatible`. An everyday-object detector must never be
  presented as a medical model.
* Segmentation, classification or pose checkpoints (a detection model is
  required).

The backend cannot verify that a custom model is clinically sound. The class
names inside the checkpoint are shown to the user and to Claude exactly as
they are, and every result is labelled as experimental. Validation of the
model is your responsibility.

## Without weights

The app still works. When an analysis is requested, the tool returns
`model_not_configured` and the assistant explains that no analysis was
performed.

For interface testing there is a **demo mode** (Настройки → Демо режим). It
draws random placeholder boxes and is labelled as a simulation in the tool
result, on the image itself and in the chat. It can be disabled on the server
with `YOLO_ALLOW_DEMO_MODE=false`, and it is unavailable whenever a real model
is configured.

## Image triage model (downloaded automatically)

`models/triage/` is the Hugging Face cache for the zero-shot CLIP vision
transformer (`openai/clip-vit-base-patch32` by default, about 600 MB) that
labels every uploaded image as `xray`, `scan`, `document` or `photo` before
Claude sees the attachment metadata. For an X-ray the backend runs
`analyze_xray` itself before Claude answers, and the tool refuses photos and
documents without running YOLO.

* Downloaded on the first start (safetensors only; no pickled checkpoints are
  loaded) and run on the CPU. The pictures never leave the server.
* The folder is created automatically, is safe to delete, and is not committed.
* Configured with the `IMAGE_TRIAGE_*` settings in `.env.example`;
  `IMAGE_TRIAGE_ENABLED=false` skips the download, and every upload is then
  labelled `unknown`, so the assistant decides from the message alone.
* `GET /api/health` reports `image_triage.status`: `ready`, `loading`,
  `disabled`, `not_installed` (the `transformers` package is missing) or `error`.
