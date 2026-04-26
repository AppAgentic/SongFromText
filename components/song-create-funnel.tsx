"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  LockKeyhole,
  Mail,
  Play,
  Plus,
  X,
} from "lucide-react";
import { signInAnonymously } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { identifyFirebaseAnalyticsUser, trackFirebaseAnalyticsEvent } from "@/lib/firebase/analytics";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { structureLyrics } from "@/lib/lyrics";
import { getMetaAttribution, trackMetaPixelEvent } from "@/lib/meta/client";
import {
  CUSTOM_SOUND_MAX_CHARS,
  KIE_LYRICS_PROMPT_MAX_CHARS,
  MAX_MESSAGE_LINES,
  MIN_MESSAGE_CHARS,
  MIN_MESSAGE_LINES,
} from "@/lib/song-limits";
import { cn } from "@/lib/utils";
import { getSongVibe, type VibeId } from "@/lib/vibes";

const PREVIEW_PROCESSING_MS = 3400;
const WEEKLY_PRICE_LABEL = `£${process.env.NEXT_PUBLIC_SONG_WEEKLY_PRICE_GBP ?? "6.99"}/week`;

const SAMPLE_MESSAGES = [
  "I never meant to hurt you.",
  "I did not think you cared anymore.",
  "You moved on so fast.",
  "I still miss how we used to talk all night.",
  "You promised you would not leave.",
];

const FLOW_STEPS = ["Hook", "Messages", "Sound", "Preview"] as const;

const HERO_IMAGE = "https://picsum.photos/seed/songfromtext-sunset/900/1500";
const PREVIEW_IMAGE = "https://picsum.photos/seed/songfromtext-rain-window/900/760";

const PROCESSING_STEPS = [
  "Finding the emotional hook",
  "Keeping every word exact",
  "Building your locked preview",
];

const PAYWALL_BENEFITS = [
  "Unlimited songs this week",
  "Uses their exact words",
  "Download the MP3",
  "Cancel anytime",
];

const SOUND_REFINEMENT_CHIPS = [
  "short chorus",
  "male vocal",
  "female vocal",
  "piano-led",
  "slow tempo",
  "more dramatic",
];

const DESKTOP_WORKFLOW_STEPS = [
  {
    label: "Messages",
    detail: "Paste the exact words",
  },
  {
    label: "Sound",
    detail: "Choose the genre",
  },
  {
    label: "Unlock",
    detail: "Save and continue",
  },
] as const;

const SOUND_CARDS: Array<{
  id: VibeId;
  label: string;
  detail: string;
  image: string;
}> = [
  {
    id: "uk-rnb",
    label: "UK R&B",
    detail: "Smooth, moody, emotional",
    image: "https://picsum.photos/seed/songfromtext-uk-rnb/900/360",
  },
  {
    id: "us-rnb",
    label: "US R&B",
    detail: "Modern, soulful, late night",
    image: "https://picsum.photos/seed/songfromtext-us-rnb/900/360",
  },
  {
    id: "country-heartbreak",
    label: "Country heartbreak",
    detail: "Raw, acoustic, real",
    image: "https://picsum.photos/seed/songfromtext-country/900/360",
  },
];

type CheckoutState = "idle" | "creating" | "redirecting";
type FunnelVariant = "builder" | "quiz";
type LocalGenerationStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

const LOCAL_PURCHASE_BYPASS = process.env.NEXT_PUBLIC_LOCAL_PURCHASE_BYPASS === "true";

interface CheckoutResponsePayload {
  purchase_url?: string;
  checkout_id?: string;
  meta_event_id?: string;
  price_gbp?: number;
  error?: string;
  issues?: Record<string, string[] | undefined>;
}

interface LocalGenerationTrack {
  id: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  title?: string;
  tags?: string;
  duration?: number;
}

interface LocalGenerationJob {
  id: string;
  status: LocalGenerationStatus;
  audioUrl?: string;
  coverUrl?: string;
  tracks?: LocalGenerationTrack[];
  error?: string;
}

interface LocalGenerationResponsePayload {
  job?: LocalGenerationJob;
  status_url?: string;
  error?: string;
  message?: string;
  issues?: Record<string, string[] | undefined>;
}

interface LocalGenerationState {
  status: LocalGenerationStatus;
  taskId?: string;
  audioUrl?: string;
  coverUrl?: string;
  duration?: number;
  error?: string;
}

interface MessageStats {
  chars: number;
  lyricPromptChars: number;
  count: number;
  firstLine: string;
  hasMessages: boolean;
  hasEnoughMessages: boolean;
  hasTooManyMessages: boolean;
  tooLong: boolean;
  ready: boolean;
  text: string;
}

export function SongCreateFunnel({ variant = "quiz" }: { variant?: FunnelVariant }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [vibe, setVibe] = useState<VibeId>("uk-rnb");
  const [customSound, setCustomSound] = useState("");
  const [soundRefineOpen, setSoundRefineOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPreviewProcessing, setIsPreviewProcessing] = useState(false);
  const [localGeneration, setLocalGeneration] = useState<LocalGenerationState>({
    status: "idle",
  });
  const [step, setStep] = useState(variant === "builder" ? 1 : 0);
  const previewTimerRef = useRef<number | null>(null);
  const emailTrackedRef = useRef(false);

  const stats = useMemo<MessageStats>(() => {
    const cleanMessages = messages.map((message) => message.trim()).filter(Boolean);
    const text = cleanMessages.join("\n");
    const chars = text.length;
    const lyricPromptChars = text ? structureLyrics({ text }).formatted.length : 0;
    const hasEnoughMessages = cleanMessages.length >= MIN_MESSAGE_LINES;
    const hasTooManyMessages = cleanMessages.length > MAX_MESSAGE_LINES;
    const tooLong = lyricPromptChars > KIE_LYRICS_PROMPT_MAX_CHARS;

    return {
      chars,
      lyricPromptChars,
      count: cleanMessages.length,
      firstLine: cleanMessages[0] ?? "",
      hasMessages: cleanMessages.length > 0,
      hasEnoughMessages,
      hasTooManyMessages,
      tooLong,
      ready: hasEnoughMessages && !hasTooManyMessages && chars >= MIN_MESSAGE_CHARS && !tooLong,
      text,
    };
  }, [messages]);

  const selectedVibe = getSongVibe(vibe);
  const trimmedCustomSound = customSound.trim();
  const soundLabel = buildSoundLabel(selectedVibe.label, trimmedCustomSound);
  const emailReady = isValidEmail(email);
  const isBusy = checkoutState !== "idle";
  const canUnlock = stats.ready && emailReady;
  const firstStep = variant === "builder" ? 1 : 0;
  const canGoBack = step > firstStep || isPreviewProcessing;

  useEffect(() => {
    trackFunnelEvent("create_viewed", {
      variant,
      entry_step: firstStep === 1 ? "messages" : "hook",
    });

    return () => clearPreviewTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addDraft() {
    const incoming = draft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!incoming.length) return;

    const availableSlots = Math.max(0, MAX_MESSAGE_LINES - messages.length);
    if (availableSlots === 0) {
      setError(`Use up to ${MAX_MESSAGE_LINES} messages. Remove one before adding another.`);
      return;
    }

    const accepted = incoming.slice(0, availableSlots);
    const next = [...messages, ...accepted];
    const droppedCount = incoming.length - accepted.length;

    setMessages(next);
    trackFunnelEvent("messages_added", {
      added_count: accepted.length,
      dropped_count: Math.max(0, droppedCount),
      total_count: next.length,
      char_count: next.join("\n").length,
    });
    setDraft("");
    setError(
      droppedCount > 0
        ? `Added the first ${accepted.length} line${accepted.length === 1 ? "" : "s"}. Keep it to ${MAX_MESSAGE_LINES} messages or trim longer messages to fit the lyrics budget.`
        : null,
    );
    resetLocalGeneration();
  }

  function removeMessage(index: number) {
    setMessages((current) => current.filter((_, currentIndex) => currentIndex !== index));
    trackFunnelEvent("message_removed", { index });
    setError(null);
    resetLocalGeneration();
  }

  function useSample() {
    setMessages(SAMPLE_MESSAGES);
    setDraft("");
    setError(null);
    trackFunnelEvent("sample_messages_used", {
      total_count: SAMPLE_MESSAGES.length,
      char_count: SAMPLE_MESSAGES.join("\n").length,
    });
    resetLocalGeneration();
  }

  function resetLocalGeneration() {
    setLocalGeneration({ status: "idle" });
  }

  function goNext() {
    if (step === 0) {
      trackFunnelEvent("hook_start_clicked");
      setStep(1);
      return;
    }

    if (step === 1 && !stats.ready) {
      trackFunnelEvent("validation_failed", {
        step: "messages",
        reason: messageFailureReason(stats),
        message_count: stats.count,
        char_count: stats.chars,
      });
      setError(messageGateText(stats));
      return;
    }

    if (step === 1) {
      trackFunnelEvent("messages_ready", {
        message_count: stats.count,
        char_count: stats.chars,
      });
      setError(null);
      setStep(2);
      return;
    }

    if (step === 2) {
      trackFunnelEvent("sound_selected", {
        vibe,
        custom_sound: Boolean(trimmedCustomSound),
      });
      startPreviewProcessing();
      return;
    }

    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  function goBack() {
    clearPreviewTimer();
    setIsPreviewProcessing(false);
    setError(null);
    setStep((current) => Math.max(firstStep, current - 1));
  }

  function clearPreviewTimer() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }

  function startPreviewProcessing() {
    clearPreviewTimer();
    setError(null);
    setStep(3);
    setIsPreviewProcessing(true);
    trackFunnelEvent("preview_processing_started", {
      message_count: stats.count,
      char_count: stats.chars,
      vibe,
    });

    previewTimerRef.current = window.setTimeout(() => {
      setIsPreviewProcessing(false);
      previewTimerRef.current = null;
      trackFunnelEvent("preview_viewed", {
        message_count: stats.count,
        char_count: stats.chars,
        vibe,
      });
    }, PREVIEW_PROCESSING_MS);
  }

  function handleVibeChange(nextVibe: VibeId) {
    setVibe(nextVibe);
    trackFunnelEvent("sound_option_selected", { vibe: nextVibe });
    resetLocalGeneration();
  }

  function handleCustomSoundChange(nextSound: string) {
    const value = nextSound.slice(0, CUSTOM_SOUND_MAX_CHARS);
    if (value.trim() && !customSound.trim()) {
      trackFunnelEvent("custom_sound_started", { vibe });
    }
    setCustomSound(value);
    resetLocalGeneration();
  }

  function openSoundRefine() {
    if (!soundRefineOpen) {
      trackFunnelEvent("custom_sound_opened", { vibe });
    }
    setSoundRefineOpen(true);
  }

  function appendSoundNote(note: string) {
    openSoundRefine();
    const parts = customSound
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.some((part) => part.toLowerCase() === note.toLowerCase())) return;
    handleCustomSoundChange([...parts, note].join(", "));
  }

  function handleEmailChange(nextEmail: string) {
    setEmail(nextEmail);
    if (!emailTrackedRef.current && isValidEmail(nextEmail)) {
      emailTrackedRef.current = true;
      trackFunnelEvent("email_submitted", {
        message_count: stats.count,
        char_count: stats.chars,
      });
      trackLeadConversion(nextEmail.trim().toLowerCase());
    }
  }

  async function handleCheckout() {
    trackFunnelEvent("unlock_clicked", {
      ready: stats.ready,
      email_ready: emailReady,
      local_bypass: LOCAL_PURCHASE_BYPASS,
      message_count: stats.count,
      char_count: stats.chars,
    });

    if (!stats.ready) {
      setStep(1);
      trackFunnelEvent("validation_failed", {
        step: "unlock",
        reason: messageFailureReason(stats),
        message_count: stats.count,
        char_count: stats.chars,
      });
      setError(messageGateText(stats));
      return;
    }
    if (!emailReady) {
      setStep(3);
      setError("Enter a valid email so we can save your result before unlock.");
      return;
    }

    if (LOCAL_PURCHASE_BYPASS) {
      await handleLocalGeneration();
      return;
    }

    setError(null);
    setCheckoutState("creating");

    try {
      const auth = getFirebaseAuth();
      const credential = auth.currentUser
        ? { user: auth.currentUser }
        : await signInAnonymously(auth);
      identifyFirebaseAnalyticsUser(credential.user.uid);
      const token = await credential.user.getIdToken();

      const response = await fetch("/api/whop/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: stats.text,
          vibe,
          email: email.trim().toLowerCase(),
          customSound: trimmedCustomSound || undefined,
          attribution: getMetaAttribution(),
        }),
      });

      const payload = await readJsonResponse<CheckoutResponsePayload>(response);

      if (!response.ok || !payload.purchase_url) {
        const firstIssue = payload.issues
          ? Object.values(payload.issues).flat().find(Boolean)
          : undefined;
        throw new Error(firstIssue ?? payload.error ?? "Checkout could not be created.");
      }

      trackFunnelEvent("checkout_created", {
        checkout_id: payload.checkout_id,
        price_gbp: payload.price_gbp ?? 6.99,
      });
      setCheckoutState("redirecting");
      trackMetaPixelEvent(
        "InitiateCheckout",
        {
          content_ids: ["songfromtext-weekly"],
          content_name: "SongFromText Weekly",
          content_type: "product",
          value: payload.price_gbp ?? 6.99,
          currency: "GBP",
          num_items: 1,
        },
        payload.meta_event_id,
      );
      trackFunnelEvent("checkout_redirected", {
        checkout_id: payload.checkout_id,
        meta_event_id: payload.meta_event_id,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      window.location.assign(payload.purchase_url);
    } catch (checkoutError) {
      setCheckoutState("idle");
      trackFunnelEvent("checkout_error", {
        message: checkoutError instanceof Error ? checkoutError.message : "Checkout could not be created.",
      });
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Checkout could not be created.",
      );
    }
  }

  async function handleLocalGeneration() {
    setError(null);
    setCheckoutState("creating");
    setLocalGeneration({ status: "queued" });
    trackFunnelEvent("generation_started", {
      local_bypass: true,
      vibe,
      message_count: stats.count,
    });

    try {
      const created = await postLocalGeneration();
      if (!created.job?.id) {
        throw new Error(created.message ?? created.error ?? "Generation could not be started.");
      }

      setLocalGeneration({
        status: created.job.status,
        taskId: created.job.id,
      });

      const finalJob = await pollLocalGeneration(
        created.status_url ?? `/api/kie/generate?taskId=${encodeURIComponent(created.job.id)}`,
      );
      const firstTrack = finalJob.tracks?.find((track) => track.audioUrl) ?? finalJob.tracks?.[0];

      if (finalJob.status === "failed" || !finalJob.audioUrl) {
        throw new Error(finalJob.error ?? "Generation failed before audio was returned.");
      }

      setLocalGeneration({
        status: "succeeded",
        taskId: finalJob.id,
        audioUrl: finalJob.audioUrl,
        coverUrl: finalJob.coverUrl,
        duration: firstTrack?.duration,
      });
      trackFunnelEvent("generation_succeeded", {
        local_bypass: true,
        task_id: finalJob.id,
        duration: firstTrack?.duration,
      });
    } catch (generationError) {
      const message = generationError instanceof Error
        ? generationError.message
        : "Generation could not be created.";
      setLocalGeneration((current) => ({
        ...current,
        status: "failed",
        error: message,
      }));
      trackFunnelEvent("generation_failed", {
        local_bypass: true,
        message,
      });
      setError(message);
    } finally {
      setCheckoutState("idle");
    }
  }

  async function postLocalGeneration(): Promise<LocalGenerationResponsePayload> {
    const response = await fetch("/api/kie/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: stats.text,
        vibe,
        customSound: trimmedCustomSound || undefined,
      }),
    });
    const payload = await readJsonResponse<LocalGenerationResponsePayload>(response);

    if (!response.ok) {
      const firstIssue = payload.issues
        ? Object.values(payload.issues).flat().find(Boolean)
        : undefined;
      throw new Error(firstIssue ?? payload.message ?? payload.error ?? "Generation could not be started.");
    }

    return payload;
  }

  async function pollLocalGeneration(statusUrl: string): Promise<LocalGenerationJob> {
    for (let attempt = 0; attempt < 48; attempt += 1) {
      await wait(attempt === 0 ? 1200 : 5000);
      const response = await fetch(statusUrl);
      const payload = await readJsonResponse<LocalGenerationResponsePayload>(response);

      if (!response.ok || !payload.job) {
        throw new Error(payload.message ?? payload.error ?? "Generation status could not be checked.");
      }

      setLocalGeneration((current) => ({
        ...current,
        status: payload.job?.status ?? current.status,
        taskId: payload.job?.id ?? current.taskId,
      }));

      if (payload.job.status === "succeeded" || payload.job.status === "failed") {
        return payload.job;
      }
    }

    throw new Error("Generation is still running. Try checking again in a moment.");
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#f7f0ea] text-[#241b25]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(247,132,118,0.18),transparent_30%),radial-gradient(circle_at_88%_10%,rgba(97,52,141,0.11),transparent_28%)]" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full justify-center xl:hidden">
        <section className="mx-auto flex h-[100dvh] min-h-0 w-full max-w-[430px] flex-col bg-[#fffaf5] shadow-[0_30px_100px_rgba(47,33,42,0.18)] sm:h-[820px] sm:overflow-hidden sm:rounded-[34px] sm:border-[10px] sm:border-[#171215]">
          {step === 0 ? (
            <HookScreen onStart={() => setStep(1)} />
          ) : (
            <QuizScreenFrame
              step={step}
              canGoBack={canGoBack}
              isProcessing={isPreviewProcessing}
              onBack={goBack}
            >
              {step === 1 ? (
                <MessagesScreen
                  messages={messages}
                  draft={draft}
                  stats={stats}
                  error={error}
                  onDraftChange={setDraft}
                  onAdd={addDraft}
                  onSample={useSample}
                  onRemove={removeMessage}
                  onNext={goNext}
                />
              ) : null}

              {step === 2 ? (
                <SoundScreen
                  vibe={vibe}
                  customSound={customSound}
                  refineOpen={soundRefineOpen}
                  onVibeChange={handleVibeChange}
                  onCustomSoundChange={handleCustomSoundChange}
                  onOpenRefine={openSoundRefine}
                  onAppendSoundNote={appendSoundNote}
                  onNext={goNext}
                />
              ) : null}

              {step === 3 && isPreviewProcessing ? (
                <ProcessingScreen stats={stats} soundLabel={soundLabel} />
              ) : null}

              {step === 3 && !isPreviewProcessing ? (
                <ResultScreen
                  stats={stats}
                  soundLabel={soundLabel}
                  email={email}
                  emailReady={emailReady}
                  error={error}
                  checkoutState={checkoutState}
                  isBusy={isBusy}
                  canUnlock={canUnlock}
                  localBypass={LOCAL_PURCHASE_BYPASS}
                  localGeneration={localGeneration}
                  onEmailChange={handleEmailChange}
                  onCheckout={handleCheckout}
                />
              ) : null}
            </QuizScreenFrame>
          )}
        </section>
      </div>

      <DesktopCreator
        step={step}
        messages={messages}
        draft={draft}
        stats={stats}
        vibe={vibe}
        customSound={customSound}
        soundLabel={soundLabel}
        email={email}
        emailReady={emailReady}
        error={error}
        canGoBack={canGoBack}
        isPreviewProcessing={isPreviewProcessing}
        checkoutState={checkoutState}
        isBusy={isBusy}
        canUnlock={canUnlock}
        localBypass={LOCAL_PURCHASE_BYPASS}
        localGeneration={localGeneration}
        soundRefineOpen={soundRefineOpen}
        onStart={() => setStep(1)}
        onBack={goBack}
        onNext={goNext}
        onDraftChange={setDraft}
        onAdd={addDraft}
        onSample={useSample}
        onRemove={removeMessage}
        onVibeChange={handleVibeChange}
        onCustomSoundChange={handleCustomSoundChange}
        onOpenRefine={openSoundRefine}
        onAppendSoundNote={appendSoundNote}
        onEmailChange={handleEmailChange}
        onCheckout={handleCheckout}
      />
    </main>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function trackFunnelEvent(eventName: string, properties: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;

  try {
    trackFirebaseAnalyticsEvent(eventName, {
      product: "songfromtext",
      ...properties,
    });
  } catch {
    // Analytics should never block the creator flow.
  }
}

function trackLeadConversion(email: string): void {
  if (typeof window === "undefined") return;

  const eventId = buildBrowserEventId("lead");
  const attribution = getMetaAttribution();

  trackMetaPixelEvent(
    "Lead",
    {
      content_ids: ["songfromtext-weekly"],
      content_name: "SongFromText Weekly",
      content_type: "product",
      currency: "GBP",
    },
    eventId,
  );

  void fetch("/api/meta/lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      eventId,
      attribution,
    }),
  }).catch(() => {
    // Conversion tracking should never block the creator flow.
  });
}

function buildBrowserEventId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildSoundLabel(label: string, customSound: string): string {
  const custom = customSound
    .replace(new RegExp(`^${escapeRegExp(label)}(?:\\s+style)?\\s*[,:-]?\\s*`, "i"), "")
    .trim();

  return custom ? `${label} + ${custom}` : label;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJsonResponse<T extends { error?: string }>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {
      error: response.ok
        ? "Server returned an empty response."
        : `Server returned ${response.status}.`,
    } as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: response.ok
        ? "Server returned an unreadable response."
        : `Server returned ${response.status}.`,
    } as T;
  }
}

function HookScreen({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="relative isolate flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#211619] px-7 pb-7 pt-7 text-white"
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(36, 24, 28, 0.10), rgba(17, 11, 10, 0.82)), url(${HERO_IMAGE})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="flex items-center justify-between text-xs font-semibold text-white/86">
        <Link href="/" className="tracking-wide">SongFromText</Link>
        <span className="rounded-full bg-white/14 px-3 py-1.5 backdrop-blur-md">Exact words</span>
      </div>

      <div className="mt-16 max-w-[18rem]">
        <h1 className="font-serif text-[3.25rem] leading-[0.96] tracking-normal text-white drop-shadow-sm">
          Still thinking about what they said?
        </h1>
        <p className="mt-7 max-w-[13rem] -rotate-3 font-serif text-[1.45rem] italic leading-[1.08] text-white/92">
          Turn it into a song you will never forget.
        </p>
      </div>

      <div className="mt-auto space-y-2.5 pb-4">
        <div className="max-w-[11rem] rounded-[17px] rounded-bl-[5px] bg-white px-3 py-2 text-[12px] leading-4 text-[#2b2429] shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
          I miss how we used to talk all night.
        </div>
        <div className="ml-auto max-w-[13rem] rounded-[17px] rounded-br-[5px] bg-[#5f309b] px-3 py-2 text-[12px] leading-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
          You promised you would not leave.
        </div>
        <div className="max-w-[12rem] rounded-[17px] rounded-bl-[5px] bg-white px-3 py-2 text-[12px] leading-4 text-[#2b2429] shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
          I wish things were different.
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="group flex h-16 w-full items-center justify-center gap-3 rounded-full bg-[#ff9b8f] text-[17px] font-semibold text-[#201113] shadow-[0_24px_50px_rgba(22,12,11,0.36)] transition hover:bg-[#ffa99e] active:scale-[0.985]"
      >
        Make my song
        <ArrowRight className="size-5 transition group-hover:translate-x-0.5" aria-hidden />
      </button>

      <div className="mt-5 flex justify-center gap-3">
        {FLOW_STEPS.map((item, index) => (
          <span
            key={item}
            className={cn("h-2 rounded-full transition-all", index === 0 ? "w-5 bg-[#ff9b8f]" : "w-2 bg-white/30")}
          />
        ))}
      </div>
    </div>
  );
}

function QuizScreenFrame({
  step,
  canGoBack,
  isProcessing,
  onBack,
  children,
}: {
  step: number;
  canGoBack: boolean;
  isProcessing: boolean;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#fffaf5] px-5 pb-5 pt-5">
      <div className="flex h-11 items-center justify-between">
        {canGoBack ? (
          <button
            type="button"
            onClick={onBack}
            className="grid size-10 place-items-center rounded-full text-[#231c21] transition hover:bg-[#f2e8df] active:scale-[0.96]"
            aria-label="Go back"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
        ) : (
          <div className="size-10" aria-hidden />
        )}
        <div className="min-w-[150px] text-center">
          <p className="text-[13px] text-[#43363f]">
            {isProcessing ? "Building preview" : `Step ${step} of 3`}
          </p>
          <ProgressBars step={step} />
        </div>
        <div className="grid size-10 place-items-center rounded-full text-[#ff766e]">
          <Heart className="size-5" aria-hidden />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function ProgressBars({ step }: { step: number }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {[1, 2, 3].map((item) => (
        <span
          key={item}
          className={cn(
            "h-1.5 rounded-full transition-colors",
            item <= step ? "bg-[#221a20]" : "bg-[#d7cfc8]",
          )}
        />
      ))}
    </div>
  );
}

function MessagesScreen({
  messages,
  draft,
  stats,
  error,
  onDraftChange,
  onAdd,
  onSample,
  onRemove,
  onNext,
}: {
  messages: string[];
  draft: string;
  stats: MessageStats;
  error: string | null;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onSample: () => void;
  onRemove: (index: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-1 pt-6">
      <div className="shrink-0 px-1">
        <h2 className="font-serif text-[2rem] leading-tight text-[#231c21]">Add their messages</h2>
        <p className="mt-1 text-[15px] leading-6 text-[#685e64]">One by one, or paste several.</p>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
        <div className="space-y-2.5">
          {messages.map((message, index) => (
            <MessageBubble
              key={`${message}-${index}`}
              message={message}
              index={index}
              onRemove={() => onRemove(index)}
            />
          ))}
        </div>

        <div className="mt-4">
          {!messages.length ? (
            <button
              type="button"
              onClick={onSample}
              className="mb-3 h-10 w-full rounded-[14px] border border-dashed border-[#d8c9d1] bg-transparent text-[14px] font-semibold text-[#74686f] transition hover:border-[#c49ed8] hover:bg-[#fff7ff] hover:text-[#5e2584] active:scale-[0.99]"
            >
              See example
            </button>
          ) : null}

          <div className="rounded-[20px] border border-[#e2d8d0] bg-[#fffdfb] p-3 shadow-[0_14px_34px_rgba(42,32,24,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-medium text-[#2a2228]">Or paste multiple messages</p>
              <span className={cn("text-xs tabular-nums", stats.tooLong || stats.hasTooManyMessages ? "text-red-600" : "text-[#86797f]")}>
                {stats.count}/{MAX_MESSAGE_LINES}
              </span>
            </div>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Paste your messages here..."
              className="mt-3 min-h-20 w-full resize-none rounded-[14px] border border-[#ded3cb] bg-[#f6f1ed] px-4 py-3 text-[16px] leading-6 text-[#251d23] outline-none placeholder:text-[#a99ea4] focus:border-[#be8ed5] focus:ring-[3px] focus:ring-[#d9b3ea]/30"
            />
            <button
              type="button"
              onClick={onAdd}
              disabled={!draft.trim() || stats.count >= MAX_MESSAGE_LINES}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#c49ed8] bg-white text-[15px] font-semibold text-[#5e2584] transition hover:bg-[#faf4ff] active:scale-[0.99] disabled:border-[#e3d9d1] disabled:text-[#b5a9ae]"
            >
              <Plus className="size-4" aria-hidden />
              {stats.count >= MAX_MESSAGE_LINES ? "Message limit reached" : "Add another message"}
            </button>
          </div>
        </div>

        <div className="mt-3 min-h-7 px-1 text-sm leading-5">
          {error ? (
            <p className="text-red-600">{error}</p>
          ) : (
            <p className="text-[#74686f]">{messageHelperText(stats)}</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!stats.ready}
        className="shrink-0 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#17171d] text-[16px] font-semibold text-white shadow-[0_18px_40px_rgba(23,23,29,0.18)] transition hover:bg-[#23232a] active:scale-[0.99] disabled:bg-[#ded6cf] disabled:text-[#8f858a] disabled:shadow-none"
      >
        Choose sound
        <ArrowRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}

function MessageBubble({
  message,
  index,
  onRemove,
}: {
  message: string;
  index: number;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-[14px] border border-[#e2d8d0] bg-[#fffdfb] px-4 py-2.5 text-[#2a2228] shadow-[0_12px_28px_rgba(42,32,24,0.06)]"
    >
      <div className="min-w-0">
        <p className="text-[15px] leading-5">{message}</p>
        <p className="mt-1 text-right text-[10px] text-[#9b8f95]">
          10:{47 + index} PM
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid size-8 place-items-center rounded-full text-[#8b7d84] transition hover:bg-[#f3ece6] active:scale-[0.96]"
        aria-label="Remove message"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function SoundScreen({
  vibe,
  customSound,
  refineOpen,
  onVibeChange,
  onCustomSoundChange,
  onOpenRefine,
  onAppendSoundNote,
  onNext,
}: {
  vibe: VibeId;
  customSound: string;
  refineOpen: boolean;
  onVibeChange: (vibe: VibeId) => void;
  onCustomSoundChange: (sound: string) => void;
  onOpenRefine: () => void;
  onAppendSoundNote: (note: string) => void;
  onNext: () => void;
}) {
  const showRefine = refineOpen || Boolean(customSound.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-1 pt-6">
      <div className="shrink-0 px-1">
        <h2 className="font-serif text-[2rem] leading-tight text-[#231c21]">What&apos;s the vibe?</h2>
        <p className="mt-1 text-[15px] leading-6 text-[#685e64]">Pick the sound of your story.</p>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
        <div className="space-y-3">
          {SOUND_CARDS.map((card) => {
            const selected = card.id === vibe;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onVibeChange(card.id)}
                className={cn(
                  "relative min-h-[86px] w-full overflow-hidden rounded-[15px] border text-left text-white shadow-[0_14px_34px_rgba(42,32,24,0.12)] transition hover:-translate-y-0.5 active:translate-y-0",
                  selected ? "border-[#7c2bb3] ring-[3px] ring-[#7c2bb3]/40" : "border-transparent",
                )}
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(25, 14, 21, 0.82), rgba(25, 14, 21, 0.28)), url(${card.image})`,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
              >
                <span className="relative flex min-h-[86px] items-center justify-between gap-4 px-5 py-4">
                  <span>
                    <span className="block text-[20px] font-semibold leading-tight">{card.label}</span>
                    <span className="mt-1 block text-[13px] text-white/86">{card.detail}</span>
                  </span>
                  {selected ? (
                    <span className="grid size-9 place-items-center rounded-full bg-[#8c33bb] text-white">
                      <Check className="size-5" aria-hidden />
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-[20px] border border-[#e2d8d0] bg-[#fffdfb] p-4 shadow-[0_14px_34px_rgba(42,32,24,0.06)]">
          <button
            type="button"
            onClick={onOpenRefine}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-[15px] font-semibold text-[#2a2228]">Refine sound</span>
              <span className="mt-1 block text-[13px] leading-5 text-[#74686f]">
                Optional. UK R&B is ready by default.
              </span>
            </span>
            <span className="grid size-9 place-items-center rounded-full bg-[#f4dfe7] text-[#a43363]">
              <Plus className="size-4" aria-hidden />
            </span>
          </button>

          {showRefine ? (
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                {SOUND_REFINEMENT_CHIPS.map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => onAppendSoundNote(note)}
                    className="rounded-full border border-[#e4d5cc] bg-white px-3 py-1.5 text-xs font-semibold text-[#4b3f46] transition hover:border-[#cda6dc] hover:bg-[#fbf4ff] active:scale-[0.98]"
                  >
                    {note}
                  </button>
                ))}
              </div>
              <label htmlFor="custom-sound" className="sr-only">
                Add your own style notes
              </label>
              <textarea
                id="custom-sound"
                value={customSound}
                onChange={(event) => onCustomSoundChange(event.target.value)}
                maxLength={CUSTOM_SOUND_MAX_CHARS}
                placeholder="e.g. softer vocal, piano-led, short chorus..."
                className="mt-3 min-h-20 w-full resize-none rounded-[14px] border border-[#ded3cb] bg-[#f6f1ed] px-4 py-3 text-[16px] leading-6 text-[#251d23] outline-none placeholder:text-[#a99ea4] focus:border-[#be8ed5] focus:ring-[3px] focus:ring-[#d9b3ea]/30"
              />
              <p className="mt-1 text-right text-xs tabular-nums text-[#9b8f95]">
                {customSound.length}/{CUSTOM_SOUND_MAX_CHARS}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="shrink-0 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#6f36a4] text-[16px] font-semibold text-white shadow-[0_18px_40px_rgba(99,50,141,0.22)] transition hover:bg-[#7d42b2] active:scale-[0.99]"
      >
        Hear preview
        <ArrowRight className="size-5" aria-hidden />
      </button>
    </div>
  );
}

function ProcessingScreen({
  stats,
  soundLabel,
}: {
  stats: MessageStats;
  soundLabel: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-1 pt-8">
      <div className="shrink-0 px-1 text-center">
        <h2 className="font-serif text-[2rem] leading-tight text-[#231c21]">Building your preview</h2>
        <p className="mt-2 text-[15px] leading-6 text-[#685e64]">
          Keeping their words exactly as written.
        </p>
      </div>

      <div className="mt-7 flex min-h-0 flex-1 flex-col justify-center rounded-[24px] border border-[#eadfd7] bg-white/72 p-5 shadow-[0_18px_54px_rgba(42,32,24,0.08)]">
        <div className="rounded-[22px] bg-[#261c25] p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/58">Preview recipe</p>
          <p className="mt-4 font-serif text-3xl italic leading-tight">
            {previewTitle(stats.firstLine) || "Their message song"}
          </p>
          <div className="mt-6">
            <WaveformBars active seed={stats.chars} />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {PROCESSING_STEPS.map((item, index) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-[16px] border border-[#eadfd7] bg-[#fffaf5] px-4 py-3 text-sm font-semibold text-[#3c3138]"
            >
              <span
                className="grid size-7 place-items-center rounded-full bg-[#f4dfe7] text-[#a43363] [animation:sft-pulse_1.4s_ease-in-out_infinite]"
                style={{ animationDelay: `${index * 180}ms` }}
              >
                <Check className="size-4" aria-hidden />
              </span>
              {item}
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] leading-4 text-[#796e75]">
          <span>{stats.count} messages</span>
          <span className="truncate">{soundLabel}</span>
          <span>Exact words</span>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({
  stats,
  soundLabel,
  email,
  emailReady,
  error,
  checkoutState,
  isBusy,
  canUnlock,
  localBypass,
  localGeneration,
  onEmailChange,
  onCheckout,
}: {
  stats: MessageStats;
  soundLabel: string;
  email: string;
  emailReady: boolean;
  error: string | null;
  checkoutState: CheckoutState;
  isBusy: boolean;
  canUnlock: boolean;
  localBypass: boolean;
  localGeneration: LocalGenerationState;
  onEmailChange: (email: string) => void;
  onCheckout: () => void;
}) {
  const hasLocalResult = localGeneration.status === "succeeded" && localGeneration.audioUrl;
  const isGenerating = localGeneration.status === "queued" || localGeneration.status === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-1 pt-6">
      <div className="shrink-0 px-1 text-center">
        <h2 className="font-serif text-[2rem] leading-tight text-[#231c21]">Your song is ready</h2>
        <p className="mt-1 text-[15px] leading-6 text-[#685e64]">Locked preview</p>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4 pr-1">
        <div
          className="relative overflow-hidden rounded-[18px] bg-[#241d22] p-4 text-white shadow-[0_20px_48px_rgba(42,32,24,0.17)]"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(27, 22, 27, 0.18), rgba(27, 22, 27, 0.74)), url(${PREVIEW_IMAGE})`,
            backgroundPosition: "center",
            backgroundSize: "cover",
          }}
        >
          <div className="absolute left-4 top-4 rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
            Locked preview
          </div>
          <div className="flex min-h-[205px] flex-col justify-end">
            <p className="mx-auto max-w-[14rem] text-center font-serif text-[2rem] italic leading-[1.03] text-white">
              {previewTitle(stats.firstLine) || "Things you said"}
            </p>
            <div className="mt-8 grid grid-cols-[42px_minmax(0,1fr)_34px] items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-white text-[#241d22]">
                {hasLocalResult ? (
                  <Play className="ml-0.5 size-5 fill-current" aria-hidden />
                ) : (
                  <LockKeyhole className="size-5" aria-hidden />
                )}
              </span>
              <WaveformBars active={isGenerating || Boolean(hasLocalResult)} seed={stats.chars} />
              <span className="text-xs tabular-nums text-white/82">0:30</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[20px] border border-[#ead7eb] bg-[#f2dff2] p-4 shadow-[0_14px_34px_rgba(82,56,88,0.08)]">
          <p className="text-[16px] font-semibold text-[#5f2584]">Save it before unlock</p>
          <p className="mt-1 text-[13px] leading-5 text-[#4c4149]">
            Enter your email so your song setup does not disappear.
          </p>
          <div className="mt-4 grid grid-cols-[42px_minmax(0,1fr)] overflow-hidden rounded-[14px] bg-white shadow-[inset_0_0_0_1px_rgba(71,55,60,0.08)] focus-within:ring-[3px] focus-within:ring-[#d9b3ea]/40">
            <div className="grid place-items-center text-[#82727c]">
              <Mail className="size-4" aria-hidden />
            </div>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
              className="h-12 min-w-0 bg-transparent pr-3 text-[16px] text-[#251d23] outline-none placeholder:text-[#a99ea4]"
            />
          </div>
          {email && !emailReady ? (
            <p className="mt-2 text-sm text-red-700">Enter a valid email to continue.</p>
          ) : null}
        </div>

        <div className="mt-4 rounded-[20px] border border-[#e7d8d0] bg-white p-4 shadow-[0_14px_34px_rgba(42,32,24,0.06)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#9c7b83]">
                Unlock includes
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#251d23]">{WEEKLY_PRICE_LABEL}</p>
            </div>
            <p className="pb-1 text-xs font-semibold text-[#74686f]">Cancel anytime</p>
          </div>
          <div className="mt-4 grid gap-2">
            {PAYWALL_BENEFITS.slice(0, 3).map((benefit) => (
              <ProofRow key={benefit} label={benefit} />
            ))}
          </div>
        </div>

        {hasLocalResult ? (
          <div className="mt-4 rounded-[16px] border border-[#e7d8d0] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-[#2a2228]">Your song</span>
              {localGeneration.duration ? (
                <span className="text-xs text-[#86797f]">{Math.round(localGeneration.duration)}s</span>
              ) : null}
            </div>
            <audio controls src={localGeneration.audioUrl} className="w-full" />
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
            {error}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] leading-4 text-[#796e75]">
            <span>{stats.count} messages</span>
            <span className="truncate">{soundLabel}</span>
            <span>Exact words</span>
          </div>
        )}
      </div>

      <Button
        type="button"
        onClick={onCheckout}
        disabled={!canUnlock || isBusy}
        className="shrink-0 h-14 w-full rounded-full border-0 bg-gradient-to-r from-[#6d35a2] to-[#cb4576] text-[16px] font-semibold text-white shadow-[0_20px_44px_rgba(117,54,128,0.24)] transition hover:opacity-95 active:scale-[0.99] disabled:bg-none disabled:bg-[#ded6cf] disabled:text-[#8f858a] disabled:shadow-none"
      >
        <LockKeyhole className="size-4" aria-hidden />
        {checkoutState === "creating"
            ? localBypass ? "Generating your song..." : "Opening unlock..."
            : checkoutState === "redirecting"
              ? "Opening Whop..."
              : "Unlock my full song"}
        <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function DesktopCreator({
  step,
  messages,
  draft,
  stats,
  vibe,
  customSound,
  soundLabel,
  email,
  emailReady,
  error,
  canGoBack,
  isPreviewProcessing,
  checkoutState,
  isBusy,
  canUnlock,
  localBypass,
  localGeneration,
  soundRefineOpen,
  onStart,
  onBack,
  onNext,
  onDraftChange,
  onAdd,
  onSample,
  onRemove,
  onVibeChange,
  onCustomSoundChange,
  onOpenRefine,
  onAppendSoundNote,
  onEmailChange,
  onCheckout,
}: {
  step: number;
  messages: string[];
  draft: string;
  stats: MessageStats;
  vibe: VibeId;
  customSound: string;
  soundLabel: string;
  email: string;
  emailReady: boolean;
  error: string | null;
  canGoBack: boolean;
  isPreviewProcessing: boolean;
  checkoutState: CheckoutState;
  isBusy: boolean;
  canUnlock: boolean;
  localBypass: boolean;
  localGeneration: LocalGenerationState;
  soundRefineOpen: boolean;
  onStart: () => void;
  onBack: () => void;
  onNext: () => void;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onSample: () => void;
  onRemove: (index: number) => void;
  onVibeChange: (vibe: VibeId) => void;
  onCustomSoundChange: (sound: string) => void;
  onOpenRefine: () => void;
  onAppendSoundNote: (note: string) => void;
  onEmailChange: (email: string) => void;
  onCheckout: () => void;
}) {
  const desktopStep = Math.min(Math.max(step, 1), 3);
  const activeWorkflowIndex = desktopStep - 1;
  const stepCaption = isPreviewProcessing
    ? "Building preview"
    : step === 0
      ? "Start with the story"
      : `Step ${desktopStep} of 3`;

  return (
    <div className="relative mx-auto hidden min-h-[100dvh] w-full max-w-[1440px] grid-cols-[300px_minmax(0,1fr)] items-stretch gap-6 px-6 py-6 xl:grid">
      <aside className="relative flex min-h-[720px] overflow-hidden rounded-[32px] border border-white/10 bg-[#251d23] p-6 text-white shadow-[0_28px_90px_rgba(47,33,42,0.18)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,155,143,0.22),rgba(255,155,143,0))]" />
        <div className="relative flex min-h-full w-full flex-col">
          <Link href="/" className="text-xs font-semibold tracking-[0.22em] text-white/60">
            SONGFROMTEXT
          </Link>

          <div className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ffb2ab]">Creator workspace</p>
            <h1 className="mt-3 font-serif text-[2.85rem] leading-[0.96] text-white">
              Turn their messages into a song.
            </h1>
            <p className="mt-5 text-sm leading-6 text-white/64">
              Build the preview first. Keep their words exact while the setup stays fast.
            </p>
          </div>

          <div className="mt-9 space-y-2">
            {DESKTOP_WORKFLOW_STEPS.map((workflowStep, index) => {
              const isActive = index === activeWorkflowIndex;
              const isComplete = index < activeWorkflowIndex;

              return (
                <div
                  key={workflowStep.label}
                  className={cn(
                    "grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-[18px] border px-3 py-3 transition",
                    isActive
                      ? "border-white/18 bg-white/[0.11] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "border-transparent bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-full text-xs font-semibold",
                      isComplete
                        ? "bg-[#f4dfe7] text-[#8d2f62]"
                        : isActive
                          ? "bg-white text-[#251d23]"
                          : "bg-white/10 text-white/50",
                    )}
                  >
                    {isComplete ? <Check className="size-4" aria-hidden /> : index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{workflowStep.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-white/52">{workflowStep.detail}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-auto rounded-[24px] border border-white/10 bg-white/[0.07] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <p className="font-serif text-2xl leading-tight text-white">{customerFriendlyStatus(step)}</p>
            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/52">Messages</span>
                <span className="font-semibold text-white">{stats.count}/{MAX_MESSAGE_LINES}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/52">Sound</span>
                <span className="max-w-[9rem] truncate font-semibold text-white">{soundLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/52">Lyrics</span>
                <span className="font-semibold text-white">Exact words</span>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm text-white/72">
              <div className="flex items-center gap-2">
                <Check className="size-4 text-[#ffb2ab]" aria-hidden />
                No rewriting
              </div>
              <div className="flex items-center gap-2">
                <Check className="size-4 text-[#ffb2ab]" aria-hidden />
                Email capture before unlock
              </div>
            </div>
          </div>
        </div>
      </aside>

      <section className="min-h-[720px] overflow-hidden rounded-[34px] border border-[#eadfd7] bg-[#fffaf5] shadow-[0_30px_100px_rgba(47,33,42,0.14)]">
        <div className="flex items-center justify-between border-b border-[#eadfd7] px-7 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9c7b83]">
              Create your song
            </p>
            <p className="mt-1 text-sm text-[#74686f]">
              {stepCaption}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canGoBack ? (
              <button
                type="button"
                onClick={onBack}
                className="flex h-10 items-center gap-2 rounded-full border border-[#eadfd7] bg-white/70 px-4 text-sm font-semibold text-[#3a3036] transition hover:bg-white active:scale-[0.98]"
              >
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </button>
            ) : null}
            <span className="rounded-full bg-[#f4dfe7] px-3 py-2 text-sm font-semibold text-[#a43363]">
              Exact lyrics
            </span>
          </div>
        </div>

        <div className="min-h-[640px] p-7">
          {step === 0 ? <DesktopHookStep onStart={onStart} /> : null}
          {step === 1 ? (
            <DesktopMessagesStep
              messages={messages}
              draft={draft}
              stats={stats}
              error={error}
              onDraftChange={onDraftChange}
              onAdd={onAdd}
              onSample={onSample}
              onRemove={onRemove}
              onNext={onNext}
            />
          ) : null}
          {step === 2 ? (
            <DesktopSoundStep
              vibe={vibe}
              customSound={customSound}
              refineOpen={soundRefineOpen}
              onVibeChange={onVibeChange}
              onCustomSoundChange={onCustomSoundChange}
              onOpenRefine={onOpenRefine}
              onAppendSoundNote={onAppendSoundNote}
              onNext={onNext}
            />
          ) : null}
          {step === 3 && isPreviewProcessing ? (
            <DesktopProcessingStep stats={stats} soundLabel={soundLabel} />
          ) : null}
          {step === 3 && !isPreviewProcessing ? (
            <DesktopResultStep
              stats={stats}
              soundLabel={soundLabel}
              email={email}
              emailReady={emailReady}
              error={error}
              checkoutState={checkoutState}
              isBusy={isBusy}
              canUnlock={canUnlock}
              localBypass={localBypass}
              localGeneration={localGeneration}
              onEmailChange={onEmailChange}
              onCheckout={onCheckout}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function DesktopHookStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid min-h-[600px] grid-cols-[minmax(0,0.82fr)_minmax(300px,0.55fr)] gap-6">
      <div
        className="relative flex overflow-hidden rounded-[28px] bg-[#211619] p-8 text-white"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(36, 24, 28, 0.10), rgba(17, 11, 10, 0.82)), url(${HERO_IMAGE})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="mt-auto max-w-md">
          <h2 className="max-w-[14rem] font-serif text-[3rem] leading-[0.95] text-white">
            Still thinking about what they said?
          </h2>
          <p className="mt-7 max-w-[13rem] -rotate-2 font-serif text-[1.85rem] italic leading-tight text-white/92">
            Turn it into a song you will never forget.
          </p>
        </div>
      </div>

      <div className="flex flex-col rounded-[28px] border border-[#eadfd7] bg-white/76 p-6 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <div className="space-y-3">
          <div className="max-w-[15rem] rounded-[20px] rounded-bl-[6px] bg-[#f7f0ea] px-4 py-3 text-sm leading-5 text-[#2b2429]">
            I miss how we used to talk all night.
          </div>
          <div className="ml-auto max-w-[16rem] rounded-[20px] rounded-br-[6px] bg-[#5f309b] px-4 py-3 text-sm leading-5 text-white">
            You promised you would not leave.
          </div>
          <div className="max-w-[15rem] rounded-[20px] rounded-bl-[6px] bg-[#f7f0ea] px-4 py-3 text-sm leading-5 text-[#2b2429]">
            I wish things were different.
          </div>
        </div>

        <div className="mt-auto">
          <p className="mb-4 text-sm leading-6 text-[#675b61]">
            Start by adding the messages. You will choose the sound and see the preview before the unlock step.
          </p>
          <button
            type="button"
            onClick={onStart}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#ff9b8f] text-[16px] font-semibold text-[#201113] shadow-[0_18px_40px_rgba(247,132,118,0.24)] transition hover:bg-[#ffa99e] active:scale-[0.99]"
          >
            Start my song
            <ArrowRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function DesktopMessagesStep({
  messages,
  draft,
  stats,
  error,
  onDraftChange,
  onAdd,
  onSample,
  onRemove,
  onNext,
}: {
  messages: string[];
  draft: string;
  stats: MessageStats;
  error: string | null;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onSample: () => void;
  onRemove: (index: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="grid min-h-[600px] grid-cols-[minmax(0,1fr)_300px] gap-6">
      <div className="min-h-0">
        <h2 className="font-serif text-5xl leading-tight text-[#231c21]">Add their messages</h2>
        <p className="mt-2 text-[16px] leading-7 text-[#685e64]">
          Paste several lines at once, or add each message one by one.
        </p>

        <div className="mt-6 grid max-h-[330px] gap-3 overflow-y-auto pr-2">
          {messages.length ? (
            messages.map((message, index) => (
              <MessageBubble
                key={`${message}-${index}`}
                message={message}
                index={index}
                onRemove={() => onRemove(index)}
              />
            ))
          ) : (
            <div className="grid min-h-[180px] place-items-center rounded-[24px] border border-dashed border-[#d7c8c0] bg-white/52 p-8 text-center">
              <div>
                <p className="font-serif text-2xl text-[#2a2228]">Start with one real message.</p>
                <p className="mt-2 text-sm leading-6 text-[#74686f]">Every line you add becomes part of the lyrics.</p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-[24px] border border-[#e2d8d0] bg-white p-4 shadow-[0_14px_34px_rgba(42,32,24,0.06)]">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="desktop-message-draft" className="text-[15px] font-semibold text-[#2a2228]">
              Add more messages
            </label>
            <span className={cn("text-sm tabular-nums", stats.tooLong || stats.hasTooManyMessages ? "text-red-600" : "text-[#86797f]")}>
              {stats.count}/{MAX_MESSAGE_LINES}
            </span>
          </div>
          <textarea
            id="desktop-message-draft"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Paste your messages here..."
            className="mt-3 min-h-28 w-full resize-none rounded-[16px] border border-[#ded3cb] bg-[#f6f1ed] px-4 py-3 text-[16px] leading-6 text-[#251d23] outline-none placeholder:text-[#a99ea4] focus:border-[#be8ed5] focus:ring-[3px] focus:ring-[#d9b3ea]/30"
          />
          <div className="mt-3 flex gap-3">
            {!messages.length ? (
              <button
                type="button"
                onClick={onSample}
                className="h-11 rounded-full border border-dashed border-[#d8c9d1] bg-transparent px-5 text-sm font-semibold text-[#74686f] transition hover:border-[#c49ed8] hover:bg-[#fff7ff] hover:text-[#5e2584] active:scale-[0.99]"
              >
                See example
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAdd}
              disabled={!draft.trim() || stats.count >= MAX_MESSAGE_LINES}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#241b25] px-5 text-sm font-semibold text-white transition hover:bg-[#342838] active:scale-[0.99] disabled:bg-[#ded6cf] disabled:text-[#8f858a]"
            >
              <Plus className="size-4" aria-hidden />
              {stats.count >= MAX_MESSAGE_LINES ? "Limit reached" : "Add message"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col rounded-[26px] border border-[#eadfd7] bg-white/70 p-5 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <p className="font-serif text-3xl leading-tight text-[#251d23]">Your lyric stack</p>
        <div className="mt-5 space-y-3">
          <SummaryLine label="Messages" value={`${stats.count}/${MAX_MESSAGE_LINES}`} />
          <SummaryLine label="Lyric budget" value={`${stats.lyricPromptChars}/${KIE_LYRICS_PROMPT_MAX_CHARS}`} />
          <SummaryLine label="Status" value={stats.ready ? "Ready" : "Needs more"} />
        </div>
        <p className={cn("mt-5 text-sm leading-6", error ? "text-red-600" : "text-[#675b61]")}>
          {error ?? messageHelperText(stats)}
        </p>
        <button
          type="button"
          onClick={onNext}
          disabled={!stats.ready}
          className="mt-auto flex h-12 items-center justify-center gap-2 rounded-full bg-[#17171d] text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(23,23,29,0.18)] transition hover:bg-[#23232a] active:scale-[0.99] disabled:bg-[#ded6cf] disabled:text-[#8f858a] disabled:shadow-none"
        >
          Choose sound
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function DesktopSoundStep({
  vibe,
  customSound,
  refineOpen,
  onVibeChange,
  onCustomSoundChange,
  onOpenRefine,
  onAppendSoundNote,
  onNext,
}: {
  vibe: VibeId;
  customSound: string;
  refineOpen: boolean;
  onVibeChange: (vibe: VibeId) => void;
  onCustomSoundChange: (sound: string) => void;
  onOpenRefine: () => void;
  onAppendSoundNote: (note: string) => void;
  onNext: () => void;
}) {
  const showRefine = refineOpen || Boolean(customSound.trim());

  return (
    <div className="grid min-h-[600px] grid-cols-[minmax(0,1fr)_330px] gap-6">
      <div>
        <h2 className="font-serif text-5xl leading-tight text-[#231c21]">Pick the sound</h2>
        <p className="mt-2 text-[16px] leading-7 text-[#685e64]">
          Start with a style, then add a short note for the vocal or mood.
        </p>

        <div className="mt-7 grid gap-4">
          {SOUND_CARDS.map((card) => {
            const selected = card.id === vibe;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onVibeChange(card.id)}
                className={cn(
                  "relative min-h-[132px] overflow-hidden rounded-[22px] border text-left text-white shadow-[0_14px_34px_rgba(42,32,24,0.12)] transition hover:-translate-y-0.5 active:translate-y-0",
                  selected ? "border-[#7c2bb3] ring-[3px] ring-[#7c2bb3]/36" : "border-transparent",
                )}
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(25, 14, 21, 0.84), rgba(25, 14, 21, 0.26)), url(${card.image})`,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
              >
                <span className="relative flex min-h-[132px] items-center justify-between gap-4 px-6 py-5">
                  <span>
                    <span className="block text-[1.95rem] font-semibold leading-[1.05]">{card.label}</span>
                    <span className="mt-2 block text-sm text-white/86">{card.detail}</span>
                  </span>
                  {selected ? (
                    <span className="grid size-11 place-items-center rounded-full bg-[#8c33bb] text-white">
                      <Check className="size-6" aria-hidden />
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col rounded-[26px] border border-[#eadfd7] bg-white/70 p-5 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <p className="font-serif text-3xl leading-tight text-[#251d23]">Make it yours</p>
        <p className="mt-3 text-sm leading-6 text-[#675b61]">
          UK R&B is selected by default. Add notes only if you want a more specific vocal or mood.
        </p>
        <button
          type="button"
          onClick={onOpenRefine}
          className="mt-6 flex h-11 items-center justify-center gap-2 rounded-full border border-[#d9c8d0] bg-white text-sm font-semibold text-[#3a3036] transition hover:border-[#cda6dc] hover:bg-[#fbf4ff] active:scale-[0.98]"
        >
          <Plus className="size-4" aria-hidden />
          Refine sound
        </button>

        {showRefine ? (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {SOUND_REFINEMENT_CHIPS.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => onAppendSoundNote(note)}
                  className="rounded-full border border-[#e4d5cc] bg-white px-3 py-1.5 text-xs font-semibold text-[#4b3f46] transition hover:border-[#cda6dc] hover:bg-[#fbf4ff] active:scale-[0.98]"
                >
                  {note}
                </button>
              ))}
            </div>
            <label htmlFor="desktop-custom-sound" className="mt-4 block text-sm font-semibold text-[#2a2228]">
              Custom style notes
            </label>
            <textarea
              id="desktop-custom-sound"
              value={customSound}
              onChange={(event) => onCustomSoundChange(event.target.value)}
              maxLength={CUSTOM_SOUND_MAX_CHARS}
              placeholder="slow tempo, female vocal, piano-led..."
              className="mt-3 min-h-32 w-full resize-none rounded-[18px] border border-[#ded3cb] bg-[#f6f1ed] px-4 py-3 text-[16px] leading-6 text-[#251d23] outline-none placeholder:text-[#a99ea4] focus:border-[#be8ed5] focus:ring-[3px] focus:ring-[#d9b3ea]/30"
            />
            <p className="mt-2 text-right text-xs tabular-nums text-[#9b8f95]">
              {customSound.length}/{CUSTOM_SOUND_MAX_CHARS}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          className="mt-auto flex h-12 items-center justify-center gap-2 rounded-full bg-[#6f36a4] text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(99,50,141,0.22)] transition hover:bg-[#7d42b2] active:scale-[0.99]"
        >
          Hear preview
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function DesktopProcessingStep({
  stats,
  soundLabel,
}: {
  stats: MessageStats;
  soundLabel: string;
}) {
  return (
    <div className="grid min-h-[600px] grid-cols-[minmax(0,1fr)_330px] gap-6">
      <div
        className="relative overflow-hidden rounded-[28px] bg-[#241d22] p-7 text-white shadow-[0_20px_48px_rgba(42,32,24,0.17)]"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(27, 22, 27, 0.08), rgba(27, 22, 27, 0.82)), url(${PREVIEW_IMAGE})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="flex min-h-full flex-col justify-end">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/64">Building preview</p>
          <h2 className="mt-5 max-w-lg font-serif text-[4rem] italic leading-[0.95] text-white">
            {previewTitle(stats.firstLine) || "Their message song"}
          </h2>
          <div className="mt-8">
            <WaveformBars active seed={stats.chars} />
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-[26px] border border-[#eadfd7] bg-white/78 p-6 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <p className="font-serif text-4xl leading-tight text-[#251d23]">Your preview is being built</p>
        <p className="mt-3 text-sm leading-6 text-[#675b61]">
          A short locked preview makes the song feel real before you unlock the full version.
        </p>

        <div className="mt-7 space-y-3">
          {PROCESSING_STEPS.map((item, index) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-[16px] border border-[#eadfd7] bg-[#fffaf5] px-4 py-3 text-sm font-semibold text-[#3c3138]"
            >
              <span
                className="grid size-7 place-items-center rounded-full bg-[#f4dfe7] text-[#a43363] [animation:sft-pulse_1.4s_ease-in-out_infinite]"
                style={{ animationDelay: `${index * 180}ms` }}
              >
                <Check className="size-4" aria-hidden />
              </span>
              {item}
            </div>
          ))}
        </div>

        <div className="mt-7 space-y-3 border-t border-[#eadfd7] pt-5">
          <SummaryLine label="Messages" value={`${stats.count} added`} />
          <SummaryLine label="Sound" value={soundLabel} />
          <SummaryLine label="Lyrics" value="Exact words" />
        </div>
      </div>
    </div>
  );
}

function DesktopResultStep({
  stats,
  soundLabel,
  email,
  emailReady,
  error,
  checkoutState,
  isBusy,
  canUnlock,
  localBypass,
  localGeneration,
  onEmailChange,
  onCheckout,
}: {
  stats: MessageStats;
  soundLabel: string;
  email: string;
  emailReady: boolean;
  error: string | null;
  checkoutState: CheckoutState;
  isBusy: boolean;
  canUnlock: boolean;
  localBypass: boolean;
  localGeneration: LocalGenerationState;
  onEmailChange: (email: string) => void;
  onCheckout: () => void;
}) {
  const hasLocalResult = localGeneration.status === "succeeded" && localGeneration.audioUrl;
  const isGenerating = localGeneration.status === "queued" || localGeneration.status === "running";

  return (
    <div className="grid min-h-[600px] grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div
        className="relative overflow-hidden rounded-[28px] bg-[#241d22] p-7 text-white shadow-[0_20px_48px_rgba(42,32,24,0.17)]"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(27, 22, 27, 0.12), rgba(27, 22, 27, 0.78)), url(${PREVIEW_IMAGE})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute left-7 top-7 rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
          Locked preview
        </div>
        <div className="flex min-h-full flex-col justify-end">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/64">Your song is ready</p>
          <h2 className="mt-5 max-w-lg font-serif text-[4rem] italic leading-[0.95] text-white">
            {previewTitle(stats.firstLine) || "Things you said"}
          </h2>
          <div className="mt-8 grid grid-cols-[56px_minmax(0,1fr)_44px] items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-white text-[#241d22]">
              {hasLocalResult ? (
                <Play className="ml-0.5 size-6 fill-current" aria-hidden />
              ) : (
                <LockKeyhole className="size-6" aria-hidden />
              )}
            </span>
            <WaveformBars active={isGenerating || Boolean(hasLocalResult)} seed={stats.chars} />
            <span className="text-sm tabular-nums text-white/82">0:30</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col rounded-[26px] border border-[#eadfd7] bg-white/78 p-5 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <p className="font-serif text-3xl leading-tight text-[#251d23]">Unlock your full song</p>
        <p className="mt-3 text-sm leading-6 text-[#675b61]">
          Save the setup with your email, then continue to Whop to unlock the full version.
        </p>

        <label htmlFor="desktop-email" className="mt-6 text-sm font-semibold text-[#2a2228]">
          Email
        </label>
        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)] overflow-hidden rounded-[16px] bg-white shadow-[inset_0_0_0_1px_rgba(71,55,60,0.08)] focus-within:ring-[3px] focus-within:ring-[#d9b3ea]/40">
          <div className="grid place-items-center text-[#82727c]">
            <Mail className="size-4" aria-hidden />
          </div>
          <input
            id="desktop-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@example.com"
            className="h-12 min-w-0 bg-transparent pr-3 text-[16px] text-[#251d23] outline-none placeholder:text-[#a99ea4]"
          />
        </div>
        {email && !emailReady ? (
          <p className="mt-2 text-sm text-red-700">Enter a valid email to continue.</p>
        ) : null}

        <div className="mt-6 space-y-3">
          <SummaryLine label="Messages" value={`${stats.count} added`} />
          <SummaryLine label="Sound" value={soundLabel} />
          <SummaryLine label="Lyrics" value="Exact words" />
        </div>

        <div className="mt-5 rounded-[20px] border border-[#e7d8d0] bg-white p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9c7b83]">
                Full access
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#251d23]">{WEEKLY_PRICE_LABEL}</p>
            </div>
            <p className="pb-1 text-xs font-semibold text-[#74686f]">Cancel anytime</p>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-[#4f454b]">
            {PAYWALL_BENEFITS.map((benefit) => (
              <ProofRow key={benefit} label={benefit} />
            ))}
          </div>
        </div>

        {hasLocalResult ? (
          <div className="mt-5 rounded-[18px] border border-[#e7d8d0] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-[#2a2228]">Your song</span>
              {localGeneration.duration ? (
                <span className="text-xs text-[#86797f]">{Math.round(localGeneration.duration)}s</span>
              ) : null}
            </div>
            <audio controls src={localGeneration.audioUrl} className="w-full" />
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
            {error}
          </p>
        ) : null}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={!canUnlock || isBusy}
          className="mt-auto h-12 w-full rounded-full border-0 bg-gradient-to-r from-[#6d35a2] to-[#cb4576] text-[15px] font-semibold text-white shadow-[0_20px_44px_rgba(117,54,128,0.24)] transition hover:opacity-95 active:scale-[0.99] disabled:bg-none disabled:bg-[#ded6cf] disabled:text-[#8f858a] disabled:shadow-none"
        >
          <LockKeyhole className="size-4" aria-hidden />
          {checkoutState === "creating"
            ? localBypass ? "Generating your song..." : "Opening unlock..."
            : checkoutState === "redirecting"
              ? "Opening Whop..."
              : "Unlock my full song"}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function WaveformBars({ active, seed }: { active: boolean; seed: number }) {
  return (
    <div className="flex h-14 items-center gap-1 overflow-hidden">
      {Array.from({ length: 30 }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "w-full origin-center rounded-full",
            active ? "bg-white [animation:sft-wave_1.8s_ease-in-out_infinite]" : "bg-white/72",
          )}
          style={{
            height: `${14 + ((index * 17 + seed) % 38)}px`,
            animationDelay: `${(index % 7) * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-[#8a7d83]">{label}</span>
      <span className="max-w-[11rem] truncate font-semibold text-[#251d23]">{value}</span>
    </div>
  );
}

function ProofRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-5 place-items-center rounded-full bg-[#f4dfe7] text-[#a43363]">
        <Check className="size-3.5" aria-hidden />
      </span>
      {label}
    </div>
  );
}

function messageHelperText(stats: MessageStats): string {
  if (!stats.hasMessages) return `Add ${MIN_MESSAGE_LINES}-${MAX_MESSAGE_LINES} real messages to build a stronger song.`;
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGE_LINES - stats.count} more message${MIN_MESSAGE_LINES - stats.count === 1 ? "" : "s"} before the preview.`;
  if (stats.hasTooManyMessages) return `Use ${MAX_MESSAGE_LINES} or fewer messages so every line can stay in the song.`;
  if (stats.tooLong) return `Trim a few lines. The prepared lyrics must fit Suno's ${KIE_LYRICS_PROMPT_MAX_CHARS.toLocaleString()} character budget.`;
  if (stats.chars < MIN_MESSAGE_CHARS) return "Add a little more wording so the hook has weight.";
  return `Good. ${Math.max(0, KIE_LYRICS_PROMPT_MAX_CHARS - stats.lyricPromptChars).toLocaleString()} lyric-budget characters left.`;
}

function messageGateText(stats: MessageStats): string {
  if (!stats.hasMessages) return "Add the messages first.";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGE_LINES - stats.count} more message${MIN_MESSAGE_LINES - stats.count === 1 ? "" : "s"} needed before sound selection.`;
  if (stats.hasTooManyMessages) return `Use ${MAX_MESSAGE_LINES} or fewer messages before continuing.`;
  if (stats.tooLong) return `Trim the messages to fit Suno's ${KIE_LYRICS_PROMPT_MAX_CHARS.toLocaleString()} character lyrics limit.`;
  if (stats.chars < MIN_MESSAGE_CHARS) return "Add a little more text before continuing.";
  return "Ready to continue.";
}

function messageFailureReason(stats: MessageStats): string {
  if (!stats.hasMessages) return "no_messages";
  if (!stats.hasEnoughMessages) return "not_enough_messages";
  if (stats.hasTooManyMessages) return "too_many_messages";
  if (stats.tooLong) return "too_long";
  if (stats.chars < MIN_MESSAGE_CHARS) return "not_enough_text";
  return "unknown";
}

function customerFriendlyStatus(step: number): string {
  if (step === 0) return "Start with the messages that still stick in your head.";
  if (step === 1) return "Add the exact words you want to hear in the song.";
  if (step === 2) return "Shape the sound without changing the lyrics.";
  return "Save the preview, then unlock the full song.";
}

function previewTitle(line: string): string {
  return line
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, 48)
    .trim();
}
