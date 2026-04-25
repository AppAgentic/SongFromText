"use client";

export interface MetaAttributionPayload {
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  landingPage?: string;
  referrer?: string;
  utm?: Record<string, string>;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function getMetaAttribution(): MetaAttributionPayload {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const fbclid = params.get("fbclid") ?? undefined;
  const fbc = getCookie("_fbc") ?? (fbclid ? buildFbc(fbclid) : undefined);

  return {
    fbp: getCookie("_fbp"),
    fbc,
    fbclid,
    landingPage: window.location.href,
    referrer: document.referrer || undefined,
    utm: getUtmParams(params),
  };
}

export function trackMetaPixelEvent(
  eventName: string,
  params: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === "undefined") return;
  if (typeof window.fbq !== "function") return;

  if (eventId) {
    window.fbq("track", eventName, params, { eventID: eventId });
    return;
  }

  window.fbq("track", eventName, params);
}

function getCookie(name: string): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : undefined;
}

function buildFbc(fbclid: string): string {
  return `fb.1.${Date.now()}.${fbclid}`;
}

function getUtmParams(params: URLSearchParams): Record<string, string> | undefined {
  const utm: Record<string, string> = {};
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }

  return Object.keys(utm).length ? utm : undefined;
}
