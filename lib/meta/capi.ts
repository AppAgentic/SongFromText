/**
 * Meta Conversions API helpers.
 * Sends server-side website events and stores browser identifiers captured
 * before the user leaves for Whop checkout.
 */
import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";

export interface MetaAttribution {
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  landingPage?: string;
  referrer?: string;
  utm?: Record<string, string>;
}

export interface MetaRequestContext {
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  clientUserAgent?: string;
  referrerUrl?: string;
}

interface MetaUserData {
  external_id?: string[];
  em?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

interface MetaEvent {
  event_name: "InitiateCheckout" | "Purchase";
  event_time: number;
  event_id: string;
  event_source_url?: string;
  referrer_url?: string;
  action_source: "website";
  user_data: MetaUserData;
  custom_data: {
    value: number;
    currency: "GBP";
    content_ids: string[];
    content_name: string;
    content_type: "product";
    num_items: number;
    order_id?: string;
  };
  test_event_code?: string;
}

const PRODUCT_ID = "songfromtext-weekly";
const PRODUCT_NAME = "SongFromText Weekly";

export function generateMetaEventId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function isMetaCapiConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() &&
    process.env.META_CAPI_ACCESS_TOKEN?.trim(),
  );
}

export function getMetaRequestContext(
  req: NextRequest,
  attribution?: MetaAttribution,
): MetaRequestContext {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || undefined;

  return {
    fbp: req.cookies.get("_fbp")?.value ?? attribution?.fbp,
    fbc: req.cookies.get("_fbc")?.value ?? attribution?.fbc,
    clientIp,
    clientUserAgent: req.headers.get("user-agent") ?? undefined,
    referrerUrl: attribution?.referrer,
  };
}

export async function trackCapiInitiateCheckout(params: {
  eventId: string;
  eventTime?: number;
  value: number;
  userId: string;
  email?: string;
  eventSourceUrl?: string;
  context: MetaRequestContext;
}): Promise<void> {
  await sendMetaEvents([
    buildEvent({
      eventName: "InitiateCheckout",
      eventId: params.eventId,
      eventTime: params.eventTime,
      value: params.value,
      userId: params.userId,
      email: params.email,
      eventSourceUrl: params.eventSourceUrl,
      orderId: params.eventId,
      context: params.context,
    }),
  ]);
}

export async function trackCapiPurchase(params: {
  eventId: string;
  eventTime?: number;
  value: number;
  userId: string;
  orderId: string;
  email?: string;
  eventSourceUrl?: string;
  context: MetaRequestContext;
}): Promise<void> {
  await sendMetaEvents([
    buildEvent({
      eventName: "Purchase",
      eventId: params.eventId,
      eventTime: params.eventTime,
      value: params.value,
      userId: params.userId,
      email: params.email,
      eventSourceUrl: params.eventSourceUrl,
      orderId: params.orderId,
      context: params.context,
    }),
  ]);
}

function buildEvent(params: {
  eventName: "InitiateCheckout" | "Purchase";
  eventId: string;
  eventTime?: number;
  value: number;
  userId: string;
  email?: string;
  orderId: string;
  eventSourceUrl?: string;
  context: MetaRequestContext;
}): MetaEvent {
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();

  return {
    event_name: params.eventName,
    event_time: params.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: params.eventId,
    event_source_url: params.eventSourceUrl,
    referrer_url: params.context.referrerUrl,
    action_source: "website",
    user_data: compactObject({
      external_id: [hashSha256(params.userId)],
      em: params.email ? [hashSha256(params.email)] : undefined,
      fbp: params.context.fbp,
      fbc: params.context.fbc,
      client_ip_address: params.context.clientIp,
      client_user_agent: params.context.clientUserAgent,
    }),
    custom_data: {
      value: params.value,
      currency: "GBP",
      content_ids: [PRODUCT_ID],
      content_name: PRODUCT_NAME,
      content_type: "product",
      num_items: 1,
      order_id: params.orderId,
    },
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

async function sendMetaEvents(events: MetaEvent[]): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  if (!pixelId || !accessToken) return;

  const graphVersion = process.env.META_GRAPH_VERSION?.trim() || "v25.0";
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${pixelId}/events`);
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: events }),
    });

    if (!response.ok) {
      console.error("[Meta CAPI] API error", response.status, await response.text());
    }
  } catch (error) {
    console.error("[Meta CAPI] Network error", error);
  }
}

function hashSha256(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
