/**
 * Whop webhook handler.
 * Receives Whop billing/subscription events and syncs subscription state.
 * See PRD §7.1 (Payment flow) and §6 (Billing).
 */
import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { UnwrapWebhookEvent } from "@whop/sdk/resources/webhooks";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  generateMetaEventId,
  isMetaCapiConfigured,
  trackCapiPurchase,
  type MetaRequestContext,
} from "@/lib/meta/capi";
import { startGenerationForPaidProject } from "@/lib/generation";
import { getWeeklyPriceGbp, unwrapWebhook } from "@/lib/whop";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  let event: UnwrapWebhookEvent;
  try {
    event = unwrapWebhook(rawBody, req.headers);
  } catch (error) {
    console.warn("Invalid Whop webhook signature", error);
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const db = getAdminDb();
  const eventRef = db.collection("events").doc(`whop_${event.id}`);
  const shouldProcess = await claimWebhookEvent(db, eventRef.path, event);

  if (!shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const result = await syncSubscriptionFromWhopEvent(db, event);

    await eventRef.set(
      {
        status: "processed",
        processedAt: FieldValue.serverTimestamp(),
        result,
      },
      { merge: true },
    );

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Whop webhook processing failed", error);
    await eventRef.set(
      {
        status: "failed",
        failedAt: FieldValue.serverTimestamp(),
        error: message,
      },
      { merge: true },
    );

    return NextResponse.json(
      { error: "webhook_processing_failed" },
      { status: 500 },
    );
  }
}

type WhopEventData = Record<string, unknown>;

interface SubscriptionSyncResult {
  ignored?: true;
  updated?: true;
  ownerId?: string;
  subscriptionId?: string;
  active?: boolean;
  projectId?: string;
  generation?: Record<string, unknown>;
  eventType: string;
}

const ACTIVE_MEMBERSHIP_STATUSES = new Set([
  "active",
  "trialing",
  "completed",
  "canceling",
]);

const INACTIVE_EVENT_TYPES = new Set([
  "membership.deactivated",
  "invoice.marked_uncollectible",
  "invoice.past_due",
  "invoice.voided",
]);

const TRACKED_EVENT_TYPES = new Set([
  "membership.activated",
  "membership.deactivated",
  "membership.cancel_at_period_end_changed",
  "payment.succeeded",
  "payment.failed",
  "payment.pending",
  "invoice.paid",
  "invoice.marked_uncollectible",
  "invoice.past_due",
  "invoice.voided",
]);

const PURCHASE_CONFIRMATION_EVENT_TYPES = new Set([
  "membership.activated",
  "payment.succeeded",
  "invoice.paid",
]);

async function claimWebhookEvent(
  db: Firestore,
  eventPath: string,
  event: UnwrapWebhookEvent,
): Promise<boolean> {
  const eventRef = db.doc(eventPath);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    const status = snapshot.exists ? snapshot.get("status") : undefined;

    if (status === "processed" || status === "processing") {
      return false;
    }

    transaction.set(
      eventRef,
      compactObject({
        source: "whop",
        status: "processing",
        eventId: event.id,
        eventType: event.type,
        companyId: event.company_id ?? null,
        receivedAt: FieldValue.serverTimestamp(),
        processingStartedAt: FieldValue.serverTimestamp(),
        dataSummary: summarizeWhopData(event),
      }),
      { merge: true },
    );

    return true;
  });
}

async function syncSubscriptionFromWhopEvent(
  db: Firestore,
  event: UnwrapWebhookEvent,
): Promise<SubscriptionSyncResult> {
  if (!TRACKED_EVENT_TYPES.has(event.type)) {
    return { ignored: true, eventType: event.type };
  }

  const data = event.data as unknown as WhopEventData;
  const metadata = asRecord(data.metadata);
  const membershipId = getMembershipId(event.type, data);
  const whopUserId = getNestedString(data, "user", "id");
  const whopUserEmail = getNestedString(data, "user", "email");
  const ownerId =
    getMetadataString(metadata, "user_id") ??
    getMetadataString(metadata, "uid") ??
    getMetadataString(metadata, "firebase_uid") ??
    (await findOwnerId(db, membershipId, whopUserId, whopUserEmail));

  if (!ownerId) {
    return { ignored: true, eventType: event.type };
  }

  const status = getSubscriptionStatus(event.type, data);
  const active = getSubscriptionActive(event.type, status);
  const subscriptionId = membershipId
    ? `whop_${membershipId}`
    : `user_${ownerId}`;
  const projectId = getProjectIdFromMetadata(metadata);

  const subscriptionPatch = compactObject({
    ownerId,
    userId: ownerId,
    provider: "whop",
    active,
    status,
    whopCompanyId: event.company_id ?? getNestedString(data, "company", "id"),
    whopMembershipId: membershipId,
    whopMemberId: getNestedString(data, "member", "id"),
    whopUserId,
    whopUserEmail,
    whopPlanId: getNestedString(data, "plan", "id") ?? getNestedString(data, "current_plan", "id"),
    whopProductId: getNestedString(data, "product", "id"),
    whopCheckoutId:
      getMetadataString(metadata, "checkout_id") ??
      getMetadataString(metadata, "checkoutId") ??
      getMetadataString(metadata, "whop_checkout_id"),
    whopPaymentId: event.type.startsWith("payment.") ? getString(data.id) : undefined,
    whopInvoiceId: event.type.startsWith("invoice.") ? getString(data.id) : undefined,
    cancelAtPeriodEnd: getBoolean(data.cancel_at_period_end),
    canceledAt: toDate(data.canceled_at),
    renewalPeriodStart: toDate(data.renewal_period_start),
    renewalPeriodEnd: toDate(data.renewal_period_end),
    priceGbp: getMetadataNumber(metadata, "price_gbp"),
    currency: getString(data.currency) ?? getNestedString(data, "current_plan", "currency"),
    product: getMetadataString(metadata, "product"),
    billingPeriodDays: getMetadataNumber(metadata, "billing_period_days"),
    lastWhopEventId: event.id,
    lastWhopEventType: event.type,
    lastWhopEventAt: toDate(event.timestamp),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const userPatch = compactObject({
    subscriptionActive: active,
    subscriptionStatus: status,
    subscriptionProvider: "whop",
    subscriptionId,
    whopMembershipId: membershipId,
    whopUserId,
    whopUserEmail,
    subscriptionUpdatedAt: FieldValue.serverTimestamp(),
  });

  const batch = db.batch()
    .set(db.collection("subscriptions").doc(subscriptionId), subscriptionPatch, { merge: true })
    .set(db.collection("users").doc(ownerId), userPatch, { merge: true });

  if (projectId) {
    batch.set(
      db.collection("projects").doc(projectId),
      compactObject({
        status: active ? "paid" : "subscription_inactive",
        subscriptionActive: active,
        subscriptionStatus: status,
        subscriptionId,
        whopMembershipId: membershipId,
        whopUserId,
        whopUserEmail,
        paidAt: active ? FieldValue.serverTimestamp() : undefined,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      { merge: true },
    );
  }

  await batch.commit();

  await trackPurchaseConversionOnce({
    db,
    event,
    data,
    metadata,
    ownerId,
    subscriptionId,
    active,
  });

  const generation = await startGenerationAfterPurchaseOnce({
    db,
    event,
    active,
    projectId,
  });

  return {
    updated: true,
    ownerId,
    subscriptionId,
    active,
    projectId,
    generation,
    eventType: event.type,
  };
}

async function startGenerationAfterPurchaseOnce(params: {
  db: Firestore;
  event: UnwrapWebhookEvent;
  active: boolean;
  projectId?: string;
}): Promise<Record<string, unknown> | undefined> {
  if (!params.active || !PURCHASE_CONFIRMATION_EVENT_TYPES.has(params.event.type)) {
    return undefined;
  }
  if (!params.projectId) return undefined;

  try {
    const result = await startGenerationForPaidProject(params.db, params.projectId);
    return result as Record<string, unknown>;
  } catch (error) {
    console.error("Post-payment generation start failed", error);
    return {
      error: error instanceof Error ? error.message : "Generation could not be started.",
    };
  }
}

async function trackPurchaseConversionOnce(params: {
  db: Firestore;
  event: UnwrapWebhookEvent;
  data: WhopEventData;
  metadata: Record<string, unknown>;
  ownerId: string;
  subscriptionId: string;
  active: boolean;
}): Promise<void> {
  if (!params.active || !PURCHASE_CONFIRMATION_EVENT_TYPES.has(params.event.type)) {
    return;
  }
  if (!isMetaCapiConfigured()) return;

  const projectId =
    getMetadataString(params.metadata, "project_id") ??
    getMetadataString(params.metadata, "projectId");
  if (!projectId) return;

  const projectRef = params.db.collection("projects").doc(projectId);
  const purchase = await params.db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectRef);
    if (!project.exists || project.get("meta.purchaseTrackedAt")) return undefined;

    const attribution = asRecord(project.get("attribution"));
    const metaEventIds = asRecord(project.get("metaEventIds"));
    const projectEmail = getString(project.get("email"));
    const eventSourceUrl =
      getString(attribution.landingPage) ??
      getString(project.get("sourceUrl"));
    if (!eventSourceUrl) return undefined;

    const eventId =
      getString(metaEventIds.purchase) ??
      getMetadataString(params.metadata, "meta_purchase_event_id") ??
      generateMetaEventId("purchase");

    transaction.update(projectRef, {
      "meta.purchaseTrackedAt": FieldValue.serverTimestamp(),
      "meta.purchaseWhopEventId": params.event.id,
      "meta.purchaseWhopEventType": params.event.type,
      "metaEventIds.purchase": eventId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      eventId,
      eventTime: toUnixSeconds(params.event.timestamp),
      value: getMetadataNumber(params.metadata, "price_gbp") ?? getWeeklyPriceGbp(),
      orderId:
        getString(params.data.id) ??
        getNestedString(params.data, "membership", "id") ??
        params.subscriptionId,
      email: getNestedString(params.data, "user", "email") ?? projectEmail,
      eventSourceUrl,
      context: compactObject({
        fbp: getString(attribution.fbp),
        fbc: getString(attribution.fbc),
        clientIp: getString(attribution.clientIp),
        clientUserAgent: getString(attribution.clientUserAgent),
        referrerUrl: getString(attribution.referrer),
      }) as MetaRequestContext,
    };
  });

  if (!purchase) return;

  await trackCapiPurchase({
    eventId: purchase.eventId,
    eventTime: purchase.eventTime,
    value: purchase.value,
    userId: params.ownerId,
    orderId: purchase.orderId,
    email: purchase.email,
    eventSourceUrl: purchase.eventSourceUrl,
    context: purchase.context,
  });
}

async function findOwnerId(
  db: Firestore,
  membershipId?: string,
  whopUserId?: string,
  whopUserEmail?: string,
): Promise<string | undefined> {
  if (membershipId) {
    const subscription = await db
      .collection("subscriptions")
      .where("whopMembershipId", "==", membershipId)
      .limit(1)
      .get();
    const ownerId = subscription.docs[0]?.get("ownerId");
    if (typeof ownerId === "string" && ownerId) return ownerId;
  }

  if (whopUserId) {
    const user = await db
      .collection("users")
      .where("whopUserId", "==", whopUserId)
      .limit(1)
      .get();
    const ownerId = user.docs[0]?.id;
    if (ownerId) return ownerId;
  }

  if (whopUserEmail) {
    const user = await db
      .collection("users")
      .where("email", "==", whopUserEmail)
      .limit(1)
      .get();
    const ownerId = user.docs[0]?.id;
    if (ownerId) return ownerId;
  }

  return undefined;
}

function getSubscriptionStatus(eventType: string, data: WhopEventData): string {
  if (eventType.startsWith("membership.")) {
    return getString(data.status) ?? eventType.replace("membership.", "");
  }

  const membershipStatus = getNestedString(data, "membership", "status");
  if (membershipStatus) return membershipStatus;

  if (eventType === "payment.succeeded" || eventType === "invoice.paid") {
    return "active";
  }

  if (eventType === "payment.failed" || eventType === "payment.pending") {
    return getString(data.status) ?? eventType.replace("payment.", "");
  }

  return getString(data.status) ?? eventType.split(".")[1] ?? "unknown";
}

function getSubscriptionActive(eventType: string, status: string): boolean {
  if (INACTIVE_EVENT_TYPES.has(eventType)) return false;
  if (eventType === "payment.succeeded" || eventType === "invoice.paid") return true;
  if (eventType === "payment.failed" || eventType === "payment.pending") return false;
  return ACTIVE_MEMBERSHIP_STATUSES.has(status);
}

function getMembershipId(eventType: string, data: WhopEventData): string | undefined {
  if (eventType.startsWith("membership.")) return getString(data.id);
  return getNestedString(data, "membership", "id");
}

function summarizeWhopData(event: UnwrapWebhookEvent): Record<string, unknown> {
  const data = event.data as unknown as WhopEventData;
  const metadata = asRecord(data.metadata);

  return compactObject({
    objectId: getString(data.id),
    status: getString(data.status) ?? getNestedString(data, "membership", "status"),
    metadata,
    whopMembershipId: getMembershipId(event.type, data),
    whopUserId: getNestedString(data, "user", "id"),
    whopUserEmail: getNestedString(data, "user", "email"),
    whopPlanId: getNestedString(data, "plan", "id") ?? getNestedString(data, "current_plan", "id"),
    whopProductId: getNestedString(data, "product", "id"),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNestedString(
  value: WhopEventData,
  key: string,
  nestedKey: string,
): string | undefined {
  return getString(asRecord(value[key])[nestedKey]);
}

function getMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  return getString(metadata[key]);
}

function getMetadataNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = metadata[key];
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function getProjectIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return getMetadataString(metadata, "project_id") ??
    getMetadataString(metadata, "projectId");
}

function toUnixSeconds(value: unknown): number | undefined {
  const date = toDate(value);
  return date ? Math.floor(date.getTime() / 1000) : undefined;
}

function toDate(value: unknown): Date | undefined {
  const numericValue = typeof value === "number" ? value : Number(getString(value));
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue * 1000)
    : new Date(String(value));

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
