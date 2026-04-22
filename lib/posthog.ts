/**
 * PostHog initialization — client and server.
 * See PRD §9 (Analytics).
 */
import posthog from "posthog-js";
import { PostHog } from "posthog-node";

let _clientInitialized = false;

export function initPostHogClient(): void {
  if (_clientInitialized) return;
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  if (!key) return;
  posthog.init(key, { api_host: host, capture_pageview: "history_change" });
  _clientInitialized = true;
}

export { posthog };

let _serverClient: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (_serverClient) return _serverClient;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  if (!key) return null;
  _serverClient = new PostHog(key, { host });
  return _serverClient;
}
