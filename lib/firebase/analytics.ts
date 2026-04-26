"use client";

import {
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
  type Analytics,
} from "firebase/analytics";
import { getFirebaseApp } from "@/lib/firebase/client";

type FirebaseAnalyticsValue = string | number | boolean;

let analyticsPromise: Promise<Analytics | null> | null = null;

export function trackFirebaseAnalyticsEvent(
  eventName: string,
  properties: Record<string, unknown> = {},
): void {
  void getFirebaseAnalytics().then((analytics) => {
    if (!analytics) return;
    logEvent(analytics, normalizeEventName(eventName), sanitizeProperties(properties));
  });
}

export function identifyFirebaseAnalyticsUser(userId: string | undefined): void {
  void getFirebaseAnalytics().then((analytics) => {
    if (!analytics) return;
    setUserId(analytics, userId ?? null);
  });
}

function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim()) {
    return Promise.resolve(null);
  }

  analyticsPromise ??= isSupported()
    .then((supported) => (supported ? getAnalytics(getFirebaseApp()) : null))
    .catch((error) => {
      console.warn("[Firebase Analytics] unavailable", error);
      return null;
    });

  return analyticsPromise;
}

function normalizeEventName(eventName: string): string {
  return eventName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^firebase_|^google_|^ga_/, "")
    .slice(0, 40) || "funnel_event";
}

function sanitizeProperties(
  properties: Record<string, unknown>,
): Record<string, FirebaseAnalyticsValue> {
  const sanitized: Record<string, FirebaseAnalyticsValue> = {};

  for (const [rawKey, rawValue] of Object.entries(properties)) {
    const key = normalizeParamName(rawKey);
    if (!key) continue;

    const value = sanitizeValue(rawValue);
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return sanitized;
}

function normalizeParamName(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^firebase_|^google_|^ga_/, "")
    .slice(0, 40);
}

function sanitizeValue(value: unknown): FirebaseAnalyticsValue | undefined {
  if (typeof value === "string") return value.slice(0, 100);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}
