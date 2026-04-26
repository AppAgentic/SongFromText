"use client";

import { useMemo, useState } from "react";
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
import { getFirebaseAuth } from "@/lib/firebase/client";
import { getMetaAttribution, trackMetaPixelEvent } from "@/lib/meta/client";
import { cn } from "@/lib/utils";
import { getSongVibe, type VibeId } from "@/lib/vibes";

const MIN_MESSAGES = 5;
const MIN_CHARS = 40;
const MAX_CHARS = 2000;
const CUSTOM_SOUND_MAX_CHARS = 160;

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
  count: number;
  firstLine: string;
  hasMessages: boolean;
  hasEnoughMessages: boolean;
  tooLong: boolean;
  ready: boolean;
  text: string;
}

export function SongCreateFunnel({ variant = "quiz" }: { variant?: FunnelVariant }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [vibe, setVibe] = useState<VibeId>("uk-rnb");
  const [customSound, setCustomSound] = useState("");
  const [email, setEmail] = useState("");
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [localGeneration, setLocalGeneration] = useState<LocalGenerationState>({
    status: "idle",
  });
  const [step, setStep] = useState(variant === "builder" ? 1 : 0);

  const stats = useMemo<MessageStats>(() => {
    const cleanMessages = messages.map((message) => message.trim()).filter(Boolean);
    const text = cleanMessages.join("\n");
    const chars = text.length;

    return {
      chars,
      count: cleanMessages.length,
      firstLine: cleanMessages[0] ?? "",
      hasMessages: cleanMessages.length > 0,
      hasEnoughMessages: cleanMessages.length >= MIN_MESSAGES,
      tooLong: chars > MAX_CHARS,
      ready: cleanMessages.length >= MIN_MESSAGES && chars >= MIN_CHARS && chars <= MAX_CHARS,
      text,
    };
  }, [messages]);

  const selectedVibe = getSongVibe(vibe);
  const trimmedCustomSound = customSound.trim();
  const soundLabel = trimmedCustomSound
    ? `${selectedVibe.label} + ${trimmedCustomSound}`
    : selectedVibe.label;
  const emailReady = isValidEmail(email);
  const isBusy = checkoutState !== "idle";
  const canUnlock = stats.ready && emailReady;

  function addDraft() {
    const incoming = draft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!incoming.length) return;

    setMessages((current) => [...current, ...incoming].slice(0, 18));
    setDraft("");
    setError(null);
    resetLocalGeneration();
  }

  function removeMessage(index: number) {
    setMessages((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setError(null);
    resetLocalGeneration();
  }

  function useSample() {
    setMessages(SAMPLE_MESSAGES);
    setDraft("");
    setError(null);
    resetLocalGeneration();
  }

  function resetLocalGeneration() {
    setLocalGeneration({ status: "idle" });
  }

  function goNext() {
    if (step === 0) {
      setStep(1);
      return;
    }

    if (step === 1 && !stats.ready) {
      setError(messageGateText(stats));
      return;
    }

    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  function goBack() {
    setError(null);
    setStep((current) => Math.max(variant === "builder" ? 1 : 0, current - 1));
  }

  async function handleCheckout() {
    if (!stats.ready) {
      setStep(1);
      setError(messageGateText(stats));
      return;
    }
    if (!emailReady) {
      setStep(3);
      setError("Enter a valid email so we can attach the result to checkout.");
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
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      window.location.assign(payload.purchase_url);
    } catch (checkoutError) {
      setCheckoutState("idle");
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
    } catch (generationError) {
      const message = generationError instanceof Error
        ? generationError.message
        : "Generation could not be created.";
      setLocalGeneration((current) => ({
        ...current,
        status: "failed",
        error: message,
      }));
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

      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-6xl items-center gap-8 px-0 py-0 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(380px,430px)_minmax(0,0.8fr)]">
        <DesktopStoryRail step={step} stats={stats} soundLabel={soundLabel} />

        <section className="mx-auto flex h-[100dvh] min-h-0 w-full max-w-[430px] flex-col bg-[#fffaf5] shadow-[0_30px_100px_rgba(47,33,42,0.18)] sm:h-[820px] sm:overflow-hidden sm:rounded-[34px] sm:border-[10px] sm:border-[#171215]">
          {step === 0 ? (
            <HookScreen onStart={() => setStep(1)} />
          ) : (
            <QuizScreenFrame step={step} onBack={goBack}>
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
                  onVibeChange={(nextVibe) => {
                    setVibe(nextVibe);
                    resetLocalGeneration();
                  }}
                  onCustomSoundChange={(nextSound) => {
                    setCustomSound(nextSound.slice(0, CUSTOM_SOUND_MAX_CHARS));
                    resetLocalGeneration();
                  }}
                  onNext={goNext}
                />
              ) : null}

              {step === 3 ? (
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
                  onEmailChange={setEmail}
                  onCheckout={handleCheckout}
                />
              ) : null}
            </QuizScreenFrame>
          )}
        </section>

        <DesktopProof step={step} />
      </div>
    </main>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
        Let&apos;s do it
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
  onBack,
  children,
}: {
  step: number;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#fffaf5] px-5 pb-5 pt-5">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="grid size-10 place-items-center rounded-full text-[#231c21] transition hover:bg-[#f2e8df] active:scale-[0.96]"
          aria-label="Go back"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <div className="min-w-[150px] text-center">
          <p className="text-[13px] text-[#43363f]">Step {step} of 3</p>
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
              className="mb-3 h-11 w-full rounded-[14px] border border-dashed border-[#c49ed8] bg-[#fdf7ff] text-[15px] font-semibold text-[#5e2584] transition hover:bg-[#f8edff] active:scale-[0.99]"
            >
              Use sample messages
            </button>
          ) : null}

          <div className="rounded-[20px] border border-[#e2d8d0] bg-[#fffdfb] p-3 shadow-[0_14px_34px_rgba(42,32,24,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-medium text-[#2a2228]">Or paste multiple messages</p>
              <span className={cn("text-xs tabular-nums", stats.tooLong ? "text-red-600" : "text-[#86797f]")}>
                {stats.count}/{MIN_MESSAGES}
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
              disabled={!draft.trim()}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#c49ed8] bg-white text-[15px] font-semibold text-[#5e2584] transition hover:bg-[#faf4ff] active:scale-[0.99] disabled:border-[#e3d9d1] disabled:text-[#b5a9ae]"
            >
              <Plus className="size-4" aria-hidden />
              Add another message
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
        Continue
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
  const first = index === 0;

  return (
    <div
      className={cn(
        "grid min-h-[58px] grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-[14px] border px-4 py-2.5 shadow-[0_12px_28px_rgba(42,32,24,0.06)]",
        first
          ? "ml-9 rounded-bl-[5px] border-[#d0a9e2] bg-[#cba0df] text-[#241227]"
          : "border-[#e2d8d0] bg-[#fffdfb] text-[#2a2228]",
      )}
    >
      <div className="min-w-0">
        <p className="text-[15px] leading-5">{message}</p>
        <p className={cn("mt-1 text-right text-[10px]", first ? "text-[#4c3652]/70" : "text-[#9b8f95]")}>
          10:{47 + index} PM
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          "grid size-8 place-items-center rounded-full transition active:scale-[0.96]",
          first ? "text-[#5d3e64] hover:bg-white/18" : "text-[#8b7d84] hover:bg-[#f3ece6]",
        )}
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
  onVibeChange,
  onCustomSoundChange,
  onNext,
}: {
  vibe: VibeId;
  customSound: string;
  onVibeChange: (vibe: VibeId) => void;
  onCustomSoundChange: (sound: string) => void;
  onNext: () => void;
}) {
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
          <label htmlFor="custom-sound" className="text-[15px] font-medium text-[#2a2228]">
            Add your own style notes
          </label>
          <textarea
            id="custom-sound"
            value={customSound}
            onChange={(event) => onCustomSoundChange(event.target.value)}
            maxLength={CUSTOM_SOUND_MAX_CHARS}
            placeholder="e.g. slow tempo, female vocals, piano and drums, 2000s vibe..."
            className="mt-3 min-h-20 w-full resize-none rounded-[14px] border border-[#ded3cb] bg-[#f6f1ed] px-4 py-3 text-[16px] leading-6 text-[#251d23] outline-none placeholder:text-[#a99ea4] focus:border-[#be8ed5] focus:ring-[3px] focus:ring-[#d9b3ea]/30"
          />
          <p className="mt-1 text-right text-xs tabular-nums text-[#9b8f95]">{customSound.length}/{CUSTOM_SOUND_MAX_CHARS}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        className="shrink-0 flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#6f36a4] text-[16px] font-semibold text-white shadow-[0_18px_40px_rgba(99,50,141,0.22)] transition hover:bg-[#7d42b2] active:scale-[0.99]"
      >
        Continue
        <ArrowRight className="size-5" aria-hidden />
      </button>
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
        <h2 className="font-serif text-[2rem] leading-tight text-[#231c21]">Here&apos;s your song</h2>
        <p className="mt-1 text-[15px] leading-6 text-[#685e64]">Preview</p>
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
          <div className="flex min-h-[205px] flex-col justify-end">
            <p className="mx-auto max-w-[14rem] text-center font-serif text-[2rem] italic leading-[1.03] text-white">
              {previewTitle(stats.firstLine) || "Things you said"}
            </p>
            <div className="mt-8 grid grid-cols-[42px_minmax(0,1fr)_34px] items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-white text-[#241d22]">
                <Play className="ml-0.5 size-5 fill-current" aria-hidden />
              </span>
              <WaveformBars active={isGenerating || Boolean(hasLocalResult)} seed={stats.chars} />
              <span className="text-xs tabular-nums text-white/82">0:30</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[20px] border border-[#ead7eb] bg-[#f2dff2] p-4 shadow-[0_14px_34px_rgba(82,56,88,0.08)]">
          <p className="text-[16px] font-semibold text-[#5f2584]">Almost there...</p>
          <p className="mt-1 text-[13px] leading-5 text-[#4c4149]">
            Enter your email to get your full song and save it to your library.
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

        {hasLocalResult ? (
          <div className="mt-4 rounded-[16px] border border-[#e7d8d0] bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-[#2a2228]">Local test output</span>
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
          ? localBypass ? "Generating locally..." : "Creating checkout..."
          : checkoutState === "redirecting"
            ? "Opening Whop..."
            : "Unlock weekly access"}
        <ArrowRight className="size-4" aria-hidden />
      </Button>
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

function DesktopStoryRail({
  step,
  stats,
  soundLabel,
}: {
  step: number;
  stats: MessageStats;
  soundLabel: string;
}) {
  return (
    <aside className="hidden self-center lg:block">
      <p className="text-sm font-semibold tracking-[0.18em] text-[#8a6870]">SONGFROMTEXT</p>
      <h1 className="mt-4 max-w-sm font-serif text-[4.5rem] leading-[0.92] text-[#251d23]">
        Turn their messages into a song.
      </h1>
      <div className="mt-8 space-y-4 text-sm leading-6 text-[#675b61]">
        <p>Built for mobile ad traffic: hook first, messages first, sell only after the result feels personal.</p>
        <div className="rounded-[18px] border border-[#eadfd7] bg-white/55 p-4 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
          <p className="font-semibold text-[#251d23]">Current setup</p>
          <div className="mt-3 space-y-2">
            <SummaryLine label="Step" value={FLOW_STEPS[step]} />
            <SummaryLine label="Messages" value={`${stats.count}/${MIN_MESSAGES}`} />
            <SummaryLine label="Sound" value={soundLabel} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function DesktopProof({ step }: { step: number }) {
  return (
    <aside className="hidden self-end pb-8 lg:block">
      <div className="rounded-[24px] border border-[#eadfd7] bg-white/58 p-5 shadow-[0_18px_60px_rgba(42,32,24,0.06)]">
        <p className="font-serif text-2xl leading-tight text-[#251d23]">{desktopProofTitle(step)}</p>
        <p className="mt-3 text-sm leading-6 text-[#675b61]">
          The price stays out of sight until the user has added real messages and reached a personalized preview.
        </p>
        <div className="mt-5 space-y-3 text-sm text-[#4f454b]">
          <ProofRow label="Email before unlock" />
          <ProofRow label="Exact words preserved" />
          <ProofRow label="No Kie cost pre-paywall" />
        </div>
      </div>
    </aside>
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
  if (!stats.hasMessages) return "Add at least five real messages. The price stays hidden.";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGES - stats.count} more message${MIN_MESSAGES - stats.count === 1 ? "" : "s"} before the preview.`;
  if (stats.tooLong) return "Trim the transcript before continuing.";
  if (stats.chars < MIN_CHARS) return "Add a little more wording so the hook has weight.";
  return "Good. You have enough exact words for a first song.";
}

function messageGateText(stats: MessageStats): string {
  if (!stats.hasMessages) return "Add the messages first.";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGES - stats.count} more message${MIN_MESSAGES - stats.count === 1 ? "" : "s"} needed before sound selection.`;
  if (stats.tooLong) return "Trim the messages before continuing.";
  if (stats.chars < MIN_CHARS) return "Add a little more text before continuing.";
  return "Almost there.";
}

function desktopProofTitle(step: number): string {
  if (step === 0) return "The hook sells the emotion, not the tool.";
  if (step === 1) return "The message input feels like building the song.";
  if (step === 2) return "Sound is simple, visual, and editable.";
  return "Email and unlock sit on the personalized preview.";
}

function previewTitle(line: string): string {
  return line
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, 48)
    .trim();
}
