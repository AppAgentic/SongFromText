/**
 * Whop webhook handler.
 * Receives subscription.created, subscription.renewed, subscription.cancelled, etc.
 * See PRD §7.1 (Payment flow) and §6 (Billing).
 *
 * STUB — verification and state sync not yet implemented.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("whop-signature");

  // TODO: verifyWebhook(rawBody, signature) — see lib/whop.ts
  void rawBody;
  void signature;

  // TODO: parse event, update users/{uid} + subscriptions/{id} in Firestore
  return NextResponse.json({ received: true });
}
