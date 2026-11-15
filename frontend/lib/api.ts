import type { Attachment, ChatEvent, Health } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "error", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const UNREACHABLE =
  "Няма връзка със сървъра на MedAI. Уверете се, че бекендът е стартиран.";

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const err = body?.error;
    if (err?.message) return new ApiError(err.message, err.code ?? "error", response.status);
  } catch {
    /* not JSON */
  }
  return new ApiError(`Грешка на сървъра (${response.status}).`, "http_error", response.status);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(UNREACHABLE, "unreachable");
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const response = await request("/api/health", { signal });
  return (await response.json()) as Health;
}

export async function uploadImage(
  file: File,
  conversationId: string,
  sessionId: string,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("conversation_id", conversationId);
  const response = await request("/api/upload", {
    method: "POST",
    headers: { "X-Session-Id": sessionId },
    body: form,
  });
  const data = await response.json();
  return {
    imageId: data.image_id,
    filename: data.filename,
    width: data.width,
    height: data.height,
    mediaType: data.media_type === "pdf" ? "pdf" : "image",
    pages: data.pages ?? 1,
    content: data.content ?? "unknown",
  };
}

/**
 * Images are session-protected, so they are fetched with the session header
 * and shown through an object URL instead of a plain <img src>.
 */
const imageCache = new Map<string, Promise<string>>();

export function loadImageUrl(imageId: string, sessionId: string): Promise<string> {
  const key = `${sessionId}:${imageId}`;
  let pending = imageCache.get(key);
  if (!pending) {
    pending = request(`/api/images/${encodeURIComponent(imageId)}`, {
      headers: { "X-Session-Id": sessionId },
    })
      .then((r) => r.blob())
      .then((blob) => URL.createObjectURL(blob));
    pending.catch(() => imageCache.delete(key));
    imageCache.set(key, pending);
  }
  return pending;
}

export function clearImageCache() {
  for (const pending of imageCache.values()) {
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  imageCache.clear();
}

export async function deleteConversation(conversationId: string, sessionId: string) {
  await request(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    headers: { "X-Session-Id": sessionId },
  });
}

export async function deleteSession(sessionId: string) {
  await request("/api/session", { method: "DELETE", headers: { "X-Session-Id": sessionId } });
}

export type ChatPayload = {
  conversation_id: string;
  consent: boolean;
  demo_mode: boolean;
  history: {
    role: "user" | "assistant";
    text: string;
    attachment_ids: string[];
    tool_result_ids: string[];
  }[];
  message: { text: string; attachment_ids: string[] };
};

/** POST /api/chat and dispatch each server-sent event as it arrives. */
export async function streamChat(
  payload: ChatPayload,
  sessionId: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.body) throw new ApiError("Сървърът не върна отговор.", "empty_stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
      } catch {
        /* ignore a malformed frame */
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        flush(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) flush(buffer);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Връзката със сървъра прекъсна по време на отговора.", "stream_interrupted");
  }
}
