import posthog from "posthog-js";

let clientInitialized = false;

export function initPostHogClient(): void {
  if (clientInitialized) return;
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  if (!key) return;
  posthog.init(key, { api_host: host, capture_pageview: "history_change" });
  clientInitialized = true;
}

export { posthog };
