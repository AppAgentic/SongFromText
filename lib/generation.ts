/**
 * Server-side generation orchestration.
 * Starts Kie only after a project has been marked paid, then persists status
 * on both `projects/{projectId}` and `generations/{projectId}`.
 */
import { randomUUID } from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { createGenerationJob, pollJob, type KieJob } from "@/lib/kie";
import { structureLyrics } from "@/lib/lyrics";
import { KIE_TITLE_MAX_CHARS } from "@/lib/song-limits";
import { getSongVibe, VIBE_VALUES, type VibeId } from "@/lib/vibes";

export type PersistedGenerationStatus =
  | "not_started"
  | "starting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export interface ProjectGenerationSummary {
  id?: string;
  taskId?: string;
  status: PersistedGenerationStatus;
  audioUrl?: string;
  coverUrl?: string;
  title?: string;
  style?: string;
  duration?: number;
  tracks?: Array<{
    id: string;
    audioUrl?: string;
    streamAudioUrl?: string;
    imageUrl?: string;
    title?: string;
    tags?: string;
    duration?: number;
  }>;
  error?: string;
}

interface StartGenerationResult {
  started?: true;
  skipped?: true;
  reason?: string;
  generation?: ProjectGenerationSummary;
}

interface ClaimGeneration {
  projectId: string;
  generationId: string;
  attemptId: string;
  ownerId: string;
  inputText: string;
  vibe: VibeId;
  customSound?: string;
  title?: string;
}

const BLOCKING_GENERATION_STATUSES = new Set([
  "starting",
  "queued",
  "running",
  "succeeded",
]);

export async function startGenerationForPaidProject(
  db: Firestore,
  projectId: string,
): Promise<StartGenerationResult> {
  const projectRef = db.collection("projects").doc(projectId);
  const generationRef = db.collection("generations").doc(projectId);

  const claim = await db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectRef);
    if (!project.exists) {
      return { skipped: true as const, reason: "project_not_found" };
    }

    const status = getString(project.get("status"));
    const subscriptionActive = project.get("subscriptionActive") === true;
    if (status !== "paid" && !subscriptionActive) {
      return { skipped: true as const, reason: "payment_not_confirmed" };
    }

    const generationStatus = getString(project.get("generationStatus"));
    if (generationStatus && BLOCKING_GENERATION_STATUSES.has(generationStatus)) {
      return {
        skipped: true as const,
        reason: "generation_already_claimed",
        generation: summarizeGenerationFromProject(project.data()),
      };
    }

    const inputText = getString(project.get("inputText"));
    const ownerId = getString(project.get("ownerId"));
    if (!inputText || !ownerId) {
      return { skipped: true as const, reason: "missing_project_input" };
    }

    const generationId = projectId;
    const attemptId = randomUUID();
    const vibe = normalizeVibe(project.get("vibe"));
    const customSound = getString(project.get("customSound"));

    transaction.set(
      projectRef,
      {
        status: "generating",
        generationStatus: "starting",
        generationId,
        generationAttemptId: attemptId,
        generationStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      generationRef,
      {
        id: generationId,
        projectId,
        ownerId,
        provider: "kie",
        status: "starting",
        attemptId,
        inputText,
        vibe,
        customSound: customSound ?? null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      projectId,
      generationId,
      attemptId,
      ownerId,
      inputText,
      vibe,
      customSound,
    } satisfies ClaimGeneration;
  });

  if ("skipped" in claim) return claim;

  const lyrics = structureLyrics({ text: claim.inputText });
  const selectedVibe = getSongVibe(claim.vibe);
  const style = claim.customSound
    ? `${selectedVibe.sunoStyle}, ${claim.customSound}`
    : selectedVibe.sunoStyle;
  const title = clamp(lyrics.title || "Their Message Song", KIE_TITLE_MAX_CHARS);

  try {
    const job = await createGenerationJob({
      lyrics: lyrics.formatted,
      style,
      title,
      negativeTags: selectedVibe.negativeTags,
      callbackUrl: process.env.KIE_CALLBACK_URL?.trim() || undefined,
      idempotencyKey: `${claim.projectId}:${claim.attemptId}`,
    });

    const generation = {
      id: claim.generationId,
      taskId: job.id,
      status: job.status,
      title,
      style,
    } satisfies ProjectGenerationSummary;

    await db.batch()
      .set(
        generationRef,
        {
          taskId: job.id,
          status: job.status,
          title,
          style,
          lyrics: {
            title: lyrics.title,
            hook: lyrics.hook,
            lineCount: lyrics.lines.length,
            formatted: lyrics.formatted,
          },
          model: process.env.KIE_SUNO_MODEL ?? "V4_5",
          queuedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .set(
        projectRef,
        {
          status: "generating",
          generationStatus: job.status,
          generationTaskId: job.id,
          generation: {
            ...generation,
            provider: "kie",
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .commit();

    return { started: true, generation };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation could not be started.";
    await markGenerationFailed(db, projectId, claim.generationId, message);
    return {
      started: true,
      generation: {
        id: claim.generationId,
        status: "failed",
        error: message,
      },
    };
  }
}

export async function refreshProjectGeneration(
  db: Firestore,
  projectId: string,
): Promise<ProjectGenerationSummary | undefined> {
  const projectRef = db.collection("projects").doc(projectId);
  const generationRef = db.collection("generations").doc(projectId);
  const project = await projectRef.get();
  if (!project.exists) return undefined;

  const generation = summarizeGenerationFromProject(project.data());
  const taskId = generation?.taskId ?? getString(project.get("generationTaskId"));
  if (!taskId) return generation;
  if (generation?.status === "succeeded" || generation?.status === "failed") return generation;

  try {
    const job = await pollJob(taskId);
    const refreshed = summarizeKieJob(projectId, job, generation);
    const isDone = refreshed.status === "succeeded" || refreshed.status === "failed";
    const firestoreGeneration = toFirestoreGeneration(refreshed);

    await db.batch()
      .set(
        generationRef,
        compactObject({
          ...firestoreGeneration,
          status: firestoreGeneration.status,
          taskId,
          tracks: firestoreGeneration.tracks ?? null,
          audioUrl: firestoreGeneration.audioUrl ?? null,
          coverUrl: firestoreGeneration.coverUrl ?? null,
          duration: firestoreGeneration.duration ?? null,
          error: firestoreGeneration.error ?? null,
          completedAt: isDone ? FieldValue.serverTimestamp() : undefined,
          updatedAt: FieldValue.serverTimestamp(),
        }),
        { merge: true },
      )
      .set(
        projectRef,
        {
          status: refreshed.status === "succeeded"
            ? "complete"
            : refreshed.status === "failed"
              ? "generation_failed"
              : "generating",
          generationStatus: refreshed.status,
          generation: firestoreGeneration,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .commit();

    return refreshed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation status could not be checked.";
    await markGenerationFailed(db, projectId, projectId, message);
    return {
      id: projectId,
      taskId,
      status: "failed",
      error: message,
    };
  }
}

function summarizeKieJob(
  projectId: string,
  job: KieJob,
  previous?: ProjectGenerationSummary,
): ProjectGenerationSummary {
  const firstTrack = job.tracks?.find((track) => track.audioUrl) ?? job.tracks?.[0];

  return {
    id: projectId,
    taskId: job.id,
    status: job.status,
    audioUrl: job.audioUrl ?? firstTrack?.audioUrl ?? previous?.audioUrl,
    coverUrl: job.coverUrl ?? firstTrack?.imageUrl ?? previous?.coverUrl,
    title: firstTrack?.title ?? previous?.title,
    style: firstTrack?.tags ?? previous?.style,
    duration: firstTrack?.duration ?? previous?.duration,
    tracks: job.tracks,
    error: job.error ?? previous?.error,
  };
}

function summarizeGenerationFromProject(
  data: Record<string, unknown> | undefined,
): ProjectGenerationSummary | undefined {
  const generation = asRecord(data?.generation);
  const status = normalizeGenerationStatus(generation.status ?? data?.generationStatus);
  if (!status) return undefined;

  return {
    id: getString(generation.id) ?? getString(data?.generationId),
    taskId: getString(generation.taskId) ?? getString(data?.generationTaskId),
    status,
    audioUrl: getString(generation.audioUrl),
    coverUrl: getString(generation.coverUrl),
    title: getString(generation.title),
    style: getString(generation.style),
    duration: getNumber(generation.duration),
    tracks: Array.isArray(generation.tracks) ? generation.tracks as ProjectGenerationSummary["tracks"] : undefined,
    error: getString(generation.error),
  };
}

async function markGenerationFailed(
  db: Firestore,
  projectId: string,
  generationId: string,
  message: string,
): Promise<void> {
  await db.batch()
    .set(
      db.collection("generations").doc(generationId),
      {
        status: "failed",
        error: message,
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .set(
      db.collection("projects").doc(projectId),
      {
        status: "generation_failed",
        generationStatus: "failed",
        generation: {
          id: generationId,
          status: "failed",
          error: message,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .commit();
}

function normalizeVibe(value: unknown): VibeId {
  return typeof value === "string" && VIBE_VALUES.includes(value as VibeId)
    ? value as VibeId
    : "uk-rnb";
}

function normalizeGenerationStatus(value: unknown): PersistedGenerationStatus | undefined {
  if (typeof value !== "string") return undefined;
  if ([
    "not_started",
    "starting",
    "queued",
    "running",
    "succeeded",
    "failed",
  ].includes(value)) {
    return value as PersistedGenerationStatus;
  }
  return undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toFirestoreGeneration(
  generation: ProjectGenerationSummary,
): Record<string, unknown> {
  return compactObject({
    ...generation,
    tracks: generation.tracks?.map((track) => compactObject({ ...track })),
  });
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function clamp(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}
