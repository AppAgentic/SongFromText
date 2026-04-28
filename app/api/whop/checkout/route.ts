/**
 * Whop checkout creation.
 * Creates a pre-payment project draft and a dynamic weekly Whop checkout.
 * No Kie/Suno generation is triggered here.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  generateMetaEventId,
  getMetaRequestContext,
  trackCapiInitiateCheckout,
} from "@/lib/meta/capi";
import { CUSTOM_SOUND_MAX_CHARS } from "@/lib/song-limits";
import { PastedInputSchema } from "@/lib/validation";
import { VIBE_VALUES } from "@/lib/vibes";
import { createCheckout } from "@/lib/whop";

export const runtime = "nodejs";

const CheckoutRequestSchema = PastedInputSchema.extend({
  vibe: z.enum(VIBE_VALUES),
  email: z.string().trim().toLowerCase().email().max(254),
  customSound: z.string().trim().max(CUSTOM_SOUND_MAX_CHARS).optional(),
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
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }

  let uid: string;
  let decodedEmail: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const tokenEmail = decoded.email?.trim().toLowerCase();
    if (!tokenEmail || decoded.firebase?.sign_in_provider === "anonymous") {
      return NextResponse.json({ error: "account_required" }, { status: 401 });
    }

    uid = decoded.uid;
    decodedEmail = tokenEmail;
  } catch (error) {
    console.warn("Checkout auth verification failed", error);
    return NextResponse.json({ error: "invalid_auth" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = CheckoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  if (parsed.data.email !== decodedEmail) {
    return NextResponse.json({ error: "email_mismatch" }, { status: 400 });
  }

  const db = getAdminDb();
  const projectRef = db.collection("projects").doc();
  const userRef = db.collection("users").doc(uid);
  const text = parsed.data.text.trim();
  const email = parsed.data.email;
  const customSound = parsed.data.customSound?.trim() || undefined;
  const lines = getLines(text);
  const origin = getRequestOrigin(req);
  const redirectUrl = `${origin}/create?checkout=return&projectId=${projectRef.id}`;
  const sourceUrl = req.headers.get("referer") ?? `${origin}/create`;
  const preview = buildPreview(lines, parsed.data.vibe, customSound);
  const attribution = parsed.data.attribution;
  const metaContext = getMetaRequestContext(req, attribution);
  const initiateCheckoutEventId = generateMetaEventId("ic");
  const purchaseEventId = generateMetaEventId("purchase");
  const initiateCheckoutEventTime = Math.floor(Date.now() / 1000);

  await projectRef.set({
    ownerId: uid,
    status: "checkout_creating",
    generationStatus: "not_started",
    inputText: text,
    email,
    vibe: parsed.data.vibe,
    customSound: customSound ?? null,
    preview,
    attribution: compactObject({
      ...attribution,
      fbp: metaContext.fbp,
      fbc: metaContext.fbc,
      clientIp: metaContext.clientIp,
      clientUserAgent: metaContext.clientUserAgent,
      capturedAt: FieldValue.serverTimestamp(),
    }),
    sourceUrl,
    checkoutReturnUrl: redirectUrl,
    metaEventIds: {
      initiateCheckout: initiateCheckoutEventId,
      purchase: purchaseEventId,
    },
    metaEventTimes: {
      initiateCheckout: initiateCheckoutEventTime,
    },
    lineCount: lines.length,
    charCount: text.length,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  let checkout;
  try {
    checkout = await createCheckout({
      userId: uid,
      redirectUrl,
      sourceUrl,
      metadata: {
        project_id: projectRef.id,
        vibe: parsed.data.vibe,
        ...(customSound ? { custom_sound: customSound } : {}),
        meta_initiate_checkout_event_id: initiateCheckoutEventId,
        meta_purchase_event_id: purchaseEventId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown checkout error";
    await projectRef.set(
      {
        status: "checkout_failed",
        checkoutError: message,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.error("Whop checkout creation failed", error);
    return NextResponse.json(
      { error: "checkout_creation_failed" },
      { status: 502 },
    );
  }

  const checkoutPatch = {
    status: "checkout_pending",
    whopCheckoutId: checkout.id,
    whopPlanId: checkout.plan_id,
    checkout: {
      provider: "whop",
      id: checkout.id,
      planId: checkout.plan_id,
      purchaseUrl: checkout.purchase_url,
      priceGbp: checkout.price_gbp,
      billingPeriodDays: checkout.billing_period_days,
      createdAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.batch()
    .set(projectRef, checkoutPatch, { merge: true })
    .set(
      userRef,
      {
        lastProjectId: projectRef.id,
        lastWhopCheckoutId: checkout.id,
        email,
        subscriptionProvider: "whop",
        subscriptionActive: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .commit();

  await trackCapiInitiateCheckout({
    eventId: initiateCheckoutEventId,
    eventTime: initiateCheckoutEventTime,
    value: checkout.price_gbp,
    userId: uid,
    email,
    eventSourceUrl: attribution?.landingPage ?? sourceUrl,
    context: metaContext,
  });

  return NextResponse.json({
    purchase_url: checkout.purchase_url,
    project_id: projectRef.id,
    checkout_id: checkout.id,
    plan_id: checkout.plan_id,
    price_gbp: checkout.price_gbp,
    billing_period_days: checkout.billing_period_days,
    meta_event_id: initiateCheckoutEventId,
  });
}

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

function getRequestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost && forwardedProto) return `${forwardedProto}://${forwardedHost}`;
  return new URL(req.url).origin;
}

function getLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function buildPreview(
  lines: string[],
  vibe: string,
  customSound?: string,
): Record<string, unknown> {
  const hook = lines[0] ?? "Their message";
  const title = hook
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, 64)
    .trim();

  return compactObject({
    title: title || "Their message song",
    hook,
    vibe,
    customSound,
    estimatedDurationSeconds: Math.min(140, Math.max(58, lines.length * 9)),
    waveformSeed: lines.join("|").length,
  });
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
