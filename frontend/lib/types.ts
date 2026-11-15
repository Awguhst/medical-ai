export type Attachment = {
  imageId: string;
  filename: string;
  width: number;
  height: number;
  /** Absent on attachments stored before PDFs were supported */
  mediaType?: "image" | "pdf";
  pages?: number;
  /** What the local vision transformer saw in the picture */
  content?: TriageLabel;
};

export type TriageLabel = "xray" | "scan" | "document" | "photo" | "unknown";

export type Detection = {
  class_name: string;
  score: number;
  bbox: number[];
  simulated?: boolean;
};

export type Doctor = {
  name: string;
  specialties: string;
  location: string;
  rating: number | null;
  reviews_count: number | null;
  next_available: string | null;
  badges: string[];
  sponsored: boolean;
  profile_url: string;
};

export type MedicationSummary = {
  query: string;
  status: "found" | "not_found" | "unavailable";
  kind?: "product" | "active_ingredient" | null;
  name?: string | null;
  active_ingredients?: { name: string; atc: string }[];
  source_url?: string | null;
  interactions_url?: string | null;
};

export type InteractionCheck = {
  between: string[];
  status: "documented" | "none_listed" | "not_checked";
  severity?: "major" | "moderate" | "minor" | "unspecified" | null;
  same_active_ingredient?: boolean;
  source_url?: string | null;
};

export type DocumentData = {
  document_type: string;
  document_type_label: string;
  readable: "good" | "partial" | "poor";
  issued_date: string;
  issuer: string;
  summary: string;
  diagnoses: { name: string; icd10: string; kind: string }[];
  medications: { name: string; dose: string; schedule: string; duration: string; context: string }[];
  tests: { name: string; value: string; unit: string; reference_range: string; flag: string }[];
  procedures: string[];
  recommendations: string[];
  follow_up: string;
  unreadable_parts: string[];
  personal_data_omitted: boolean;
};

/** UI-facing result of a tool call, produced by the backend. */
export type ToolResultData = {
  status: string;
  message: string;
  /** "doctors" for find_doctors, "medications" for lookup_medication; absent for analyze_xray */
  kind?: "doctors" | "medications" | "document";
  /** read_document */
  document?: DocumentData | null;
  file_name?: string;
  file_type?: "image" | "pdf";
  pages?: number;
  sent_to_claude?: boolean;
  medications?: MedicationSummary[];
  interaction_checks?: InteractionCheck[];
  query?: { specialty: string; city: string | null; sort: string } | null;
  search_url?: string | null;
  doctors?: Doctor[];
  image_id?: string;
  annotated_image_id?: string | null;
  simulated?: boolean;
  model_type?: string | null;
  model_classes?: string[];
  score_threshold?: number | null;
  detections?: Detection[];
};

export type TextPart = { type: "text"; text: string };

export type ToolPart = {
  type: "tool";
  toolUseId: string;
  toolName: string;
  label: string;
  runningText: string;
  state: "running" | "done";
  isError?: boolean;
  resultId?: string;
  result?: ToolResultData;
};

export type MessagePart = TextPart | ToolPart;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  /** User messages */
  text?: string;
  attachments?: Attachment[];
  /** Assistant messages: text and tool activity in the order they happened */
  parts?: MessagePart[];
  pending?: boolean;
  stopped?: boolean;
  emergency?: boolean;
  notice?: string;
  error?: string;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

/** Interface language. Also sent to the API, which answers (and has Claude reply) in it. */
export type Language = "bg" | "en";

/** Colour theme; all three are dark. Defined in app/globals.css, listed in lib/preferences.ts. */
export type ThemeName = "graphite" | "ember" | "dusk";

export type Settings = {
  demoMode: boolean;
  /** Show tool cards (status, raw results) in the chat; off = only the reply */
  showToolActivity: boolean;
  language: Language;
  theme: ThemeName;
};

export type Health = {
  status: "ok";
  claude_configured: boolean;
  claude_model: string;
  yolo: {
    status: "ready" | "not_configured" | "weights_missing" | "incompatible" | "error";
    detail: string;
    demo_mode_allowed: boolean;
    classes: string[];
  };
  /** Absent on backends built before image triage */
  image_triage?: {
    status: "ready" | "loading" | "disabled" | "not_installed" | "error";
    detail: string;
    model: string;
  };
  tools: string[];
};

/** Events streamed by POST /api/chat */
export type ChatEvent =
  | { type: "emergency" }
  | { type: "text_delta"; text: string }
  | {
      type: "tool_start";
      tool_use_id: string;
      tool_name: string;
      label: string;
      running_text: string;
    }
  | {
      type: "tool_end";
      tool_use_id: string;
      result_id: string;
      is_error: boolean;
      result: ToolResultData;
    }
  | { type: "notice"; code: string; message: string }
  | { type: "error"; code: string; message: string }
  | { type: "done"; stop_reason: string | null; model: string };
