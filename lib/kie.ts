/**
 * Kie.ai Suno API client.
 * Handles music generation jobs. Custom mode is used to enforce verbatim lyrics.
 * See PRD §4 (Music Generation) and §7.2 (Generation flow).
 *
 * ECONOMIC RULE: do not call this client before Whop checkout succeeds (PRD §3).
 */

export type KieJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface KieTrack {
  id: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
}

export interface KieJob {
  id: string;
  status: KieJobStatus;
  audioUrl?: string;
  coverUrl?: string;
  tracks?: KieTrack[];
  error?: string;
}

export interface CreateGenerationJobInput {
  /** Final lyrics string with section tags ([Verse], [Chorus], etc.) */
  lyrics: string;
  /** Style / vibe tag (e.g. "sad acoustic", "upbeat synthpop") */
  style: string;
  /** Optional song title */
  title?: string;
  /** Negative style tags to steer away from unwanted genres. */
  negativeTags?: string;
  /** Optional HTTPS callback URL for production async completion. */
  callbackUrl?: string;
  /** Kie Suno model; defaults to V4_5 for fast custom-mode tests. */
  model?: string;
  /** Idempotency key to dedupe duplicate POSTs */
  idempotencyKey: string;
}

export async function createGenerationJob(
  input: CreateGenerationJobInput,
): Promise<KieJob> {
  const payload = {
    prompt: clamp(input.lyrics.trim(), 5000),
    style: clamp(input.style.trim(), 1000),
    title: clamp(input.title?.trim() || "Their Message Song", 80),
    customMode: true,
    instrumental: false,
    model: input.model ?? process.env.KIE_SUNO_MODEL ?? "V4_5",
    ...(input.callbackUrl ? { callBackUrl: input.callbackUrl } : {}),
    ...(input.negativeTags ? { negativeTags: input.negativeTags } : {}),
  };

  const result = await kieFetch<KieGenerateResponse>("/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  if (!result.data?.taskId) {
    throw new Error("Kie generation response did not include a taskId.");
  }

  return {
    id: result.data.taskId,
    status: "queued",
  };
}

export async function pollJob(jobId: string): Promise<KieJob> {
  const result = await kieFetch<KieRecordInfoResponse>(
    `/generate/record-info?taskId=${encodeURIComponent(jobId)}`,
  );
  const data = result.data;
  const tracks = (data?.response?.sunoData ?? []).map(normalizeTrack);
  const firstTrack = tracks[0];

  return {
    id: data?.taskId ?? jobId,
    status: mapKieStatus(data?.status),
    audioUrl: firstTrack?.audioUrl,
    coverUrl: firstTrack?.imageUrl,
    tracks,
    error: data?.errorMessage ?? undefined,
  };
}

interface KieEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

interface KieGenerateResponse {
  taskId?: string;
}

interface KieRecordInfoResponse {
  taskId?: string;
  status?: string;
  errorMessage?: string | null;
  response?: {
    sunoData?: KieRawTrack[];
  };
}

interface KieRawTrack {
  id?: string;
  audioUrl?: string;
  audio_url?: string;
  streamAudioUrl?: string;
  stream_audio_url?: string;
  imageUrl?: string;
  image_url?: string;
  title?: string;
  tags?: string;
  duration?: number;
}

async function kieFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<KieEnvelope<T>> {
  const apiKey = process.env.KIE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("KIE_API_KEY is not configured.");
  }

  const baseUrl = (process.env.KIE_API_BASE_URL ?? "https://api.kie.ai/api/v1")
    .replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...init.headers,
    },
  });
  const text = await response.text();
  const payload = parseJson<KieEnvelope<T>>(text);

  if (!response.ok || payload.code !== 200) {
    throw new Error(payload.msg ?? `Kie API request failed with HTTP ${response.status}.`);
  }

  return payload;
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Kie API returned a non-JSON response.");
  }
}

function normalizeTrack(track: KieRawTrack): KieTrack {
  return {
    id: track.id ?? "unknown",
    audioUrl: track.audioUrl ?? track.audio_url,
    streamAudioUrl: track.streamAudioUrl ?? track.stream_audio_url,
    imageUrl: track.imageUrl ?? track.image_url,
    title: track.title,
    tags: track.tags,
    duration: track.duration,
  };
}

function mapKieStatus(status: string | undefined): KieJobStatus {
  switch (status) {
    case "SUCCESS":
      return "succeeded";
    case "CREATE_TASK_FAILED":
    case "GENERATE_AUDIO_FAILED":
    case "CALLBACK_EXCEPTION":
    case "SENSITIVE_WORD_ERROR":
      return "failed";
    case "TEXT_SUCCESS":
    case "FIRST_SUCCESS":
      return "running";
    case "PENDING":
    default:
      return "queued";
  }
}

function clamp(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}
