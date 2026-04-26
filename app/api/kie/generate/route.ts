/**
 * Kie.ai generation orchestration endpoint.
 * POST-PAYMENT ONLY in production.
 *
 * Local dev can call this route directly to smoke-test Kie/Suno generation.
 * Production keeps returning not_implemented until subscription-gated job
 * orchestration is wired end-to-end.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { createGenerationJob, pollJob } from "@/lib/kie";
import { structureLyrics } from "@/lib/lyrics";
import { CUSTOM_SOUND_MAX_CHARS, KIE_TITLE_MAX_CHARS } from "@/lib/song-limits";
import { PastedInputSchema } from "@/lib/validation";
import { getSongVibe, VIBE_VALUES } from "@/lib/vibes";

export const runtime = "nodejs";

const GenerateRequestSchema = PastedInputSchema.extend({
  vibe: z.enum(VIBE_VALUES).default("uk-rnb"),
  customSound: z.string().trim().max(CUSTOM_SOUND_MAX_CHARS).optional(),
  title: z.string().trim().max(KIE_TITLE_MAX_CHARS).optional(),
  callbackUrl: z.url().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  if (!canRunKieGeneration()) return productionGuardResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const lyrics = structureLyrics({ text: parsed.data.text });
  const selectedVibe = getSongVibe(parsed.data.vibe);
  const customSound = parsed.data.customSound?.trim();
  const style = customSound
    ? `${selectedVibe.sunoStyle}, ${customSound}`
    : selectedVibe.sunoStyle;

  try {
    const job = await createGenerationJob({
      lyrics: lyrics.formatted,
      style,
      title: parsed.data.title || lyrics.title,
      negativeTags: selectedVibe.negativeTags,
      callbackUrl: parsed.data.callbackUrl ?? getDefaultCallbackUrl(),
      idempotencyKey: crypto.randomUUID(),
    });

    return NextResponse.json({
      job,
      status_url: `/api/kie/generate?taskId=${encodeURIComponent(job.id)}`,
      lyrics: {
        title: lyrics.title,
        hook: lyrics.hook,
        line_count: lyrics.lines.length,
        formatted: lyrics.formatted,
      },
      style,
      model: process.env.KIE_SUNO_MODEL ?? "V4_5",
    });
  } catch (error) {
    console.error("Kie generation failed", error);
    return NextResponse.json(
      {
        error: "kie_generation_failed",
        message: error instanceof Error ? error.message : "Unknown Kie error",
      },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!canRunKieGeneration()) return productionGuardResponse();

  const taskId = req.nextUrl.searchParams.get("taskId")?.trim();
  if (!taskId) {
    return NextResponse.json({ error: "missing_task_id" }, { status: 400 });
  }

  try {
    const job = await pollJob(taskId);
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Kie status poll failed", error);
    return NextResponse.json(
      {
        error: "kie_status_failed",
        message: error instanceof Error ? error.message : "Unknown Kie error",
      },
      { status: 502 },
    );
  }
}

function canRunKieGeneration(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_KIE_GENERATION === "true";
}

function getDefaultCallbackUrl(): string {
  return process.env.KIE_CALLBACK_URL ?? "https://httpbin.org/status/200";
}

function productionGuardResponse(): Response {
  return NextResponse.json(
    { error: "not_implemented" },
    { status: 501 },
  );
}
