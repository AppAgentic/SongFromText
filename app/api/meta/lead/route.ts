/**
 * Meta Lead event bridge.
 * Keeps browser Pixel and server CAPI deduped for email capture before checkout.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getMetaRequestContext,
  trackCapiLead,
} from "@/lib/meta/capi";

export const runtime = "nodejs";

const LeadRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  eventId: z.string().trim().min(8).max(128),
  attribution: z
    .object({
      fbp: z.string().optional(),
      fbc: z.string().optional(),
      fbclid: z.string().optional(),
      landingPage: z.string().optional(),
      referrer: z.string().optional(),
      utm: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = LeadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const attribution = parsed.data.attribution;
  await trackCapiLead({
    eventId: parsed.data.eventId,
    email: parsed.data.email,
    eventSourceUrl:
      attribution?.landingPage ??
      req.headers.get("referer") ??
      new URL(req.url).origin,
    context: getMetaRequestContext(req, attribution),
  });

  return NextResponse.json({ received: true });
}
