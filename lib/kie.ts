/**
 * Kie.ai Suno API client stub.
 * Handles music generation jobs. Custom mode is used to enforce verbatim lyrics.
 * See PRD §4 (Music Generation) and §7.2 (Generation flow).
 *
 * ECONOMIC RULE: do not call this client before Whop checkout succeeds (PRD §3).
 */

export type KieJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface KieJob {
  id: string;
  status: KieJobStatus;
  audioUrl?: string;
  coverUrl?: string;
  error?: string;
}

export interface CreateGenerationJobInput {
  /** Final lyrics string with section tags ([Verse], [Chorus], etc.) */
  lyrics: string;
  /** Style / vibe tag (e.g. "sad acoustic", "upbeat synthpop") */
  style: string;
  /** Optional song title */
  title?: string;
  /** Idempotency key to dedupe duplicate POSTs */
  idempotencyKey: string;
}

/**
 * Submit a new custom-mode generation job.
 * NOT IMPLEMENTED — fill in with Kie.ai Suno endpoint + auth headers.
 */
export async function createGenerationJob(
  input: CreateGenerationJobInput,
): Promise<KieJob> {
  void input;
  // TODO: POST to Kie.ai Suno custom-mode endpoint with KIE_API_KEY
  throw new Error("createGenerationJob not implemented");
}

/**
 * Poll job status. Webhook delivery is preferred; poll only as fallback.
 * NOT IMPLEMENTED — fill in with Kie.ai status endpoint.
 */
export async function pollJob(jobId: string): Promise<KieJob> {
  void jobId;
  throw new Error("pollJob not implemented");
}
