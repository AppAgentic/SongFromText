"use client";

import { useEffect } from "react";
import { initPostHogClient } from "@/lib/posthog-client";

export function PostHogProvider() {
  useEffect(() => {
    initPostHogClient();
  }, []);

  return null;
}
