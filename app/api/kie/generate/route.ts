/**
 * Kie.ai generation orchestration endpoint.
 * POST-PAYMENT ONLY — must verify active subscription before submitting a job.
 * See PRD §3 (Economic rule: no Kie cost before Stripe/Whop success) and §7.2.
 *
 * STUB — subscription check + job creation not yet wired.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(_req: Request): Promise<Response> {
  // TODO:
  //   1. Auth: verify Firebase ID token from Authorization header.
  //   2. Subscription check: users/{uid}.subscriptionActive === true.
  //   3. Load project doc, call lib/lyrics.structureLyrics().
  //   4. Call lib/kie.createGenerationJob() with idempotency key.
  //   5. Persist generation doc + return jobId.

  return NextResponse.json(
    { error: "not_implemented" },
    { status: 501 },
  );
}
