"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CirclePlus,
  GripVertical,
  LockKeyhole,
  MessageSquareText,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { signInAnonymously } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { getMetaAttribution, trackMetaPixelEvent } from "@/lib/meta/client";
import { cn } from "@/lib/utils";
import { getSongVibe, SONG_VIBES, type VibeId } from "@/lib/vibes";

const MIN_MESSAGES = 5;
const MIN_CHARS = 40;
const MAX_CHARS = 2000;
const CUSTOM_SOUND_MAX_CHARS = 160;
const SOUND_REFINEMENTS = [
  "garage drums",
  "smooth vocal",
  "female vocal",
  "more emotional",
  "bigger chorus",
  "slower tempo",
];

const SAMPLE_MESSAGES = [
  "I know I said I was fine but I was not",
  "You made it sound so easy to leave",
  "I still look for your name when my phone lights up",
  "Maybe that is stupid but it is true",
  "I miss who we were before everything got weird",
];

type CheckoutState = "idle" | "creating" | "redirecting";
type FunnelVariant = "builder" | "quiz";

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

export function SongCreateFunnel({ variant = "builder" }: { variant?: FunnelVariant }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [vibe, setVibe] = useState<VibeId>("uk-rnb");
  const [customSound, setCustomSound] = useState("");
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quizStep, setQuizStep] = useState(0);

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
  const isBusy = checkoutState !== "idle";
  const canRevealPrice = stats.ready;

  function addDraft() {
    const incoming = draft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!incoming.length) return;

    setMessages((current) => [...current, ...incoming].slice(0, 18));
    setDraft("");
    setError(null);
  }

  function updateMessage(index: number, value: string) {
    setMessages((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function removeMessage(index: number) {
    setMessages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function useSample() {
    setMessages(SAMPLE_MESSAGES);
    setDraft("");
    setError(null);
    if (variant === "quiz") setQuizStep(1);
  }

  async function handleCheckout() {
    if (!stats.ready) return;

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
          customSound: trimmedCustomSound || undefined,
          attribution: getMetaAttribution(),
        }),
      });

      const payload = await response.json() as {
        purchase_url?: string;
        meta_event_id?: string;
        price_gbp?: number;
        error?: string;
        issues?: Record<string, string[] | undefined>;
      };

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

  if (variant === "quiz") {
    return (
      <FunnelShell
        kicker="Song quiz"
        title="Build the song one answer at a time."
        subtitle="Start with the messages. The unlock step appears only after the song has enough words."
      >
        <QuizStepper step={quizStep} />

        {quizStep === 0 ? (
          <MessageComposer
            messages={messages}
            draft={draft}
            stats={stats}
            onDraftChange={setDraft}
            onAdd={addDraft}
            onSample={useSample}
            onUpdate={updateMessage}
            onRemove={removeMessage}
          />
        ) : null}

        {quizStep === 1 ? (
          <VibePicker
            vibe={vibe}
            selectedVibe={selectedVibe}
            customSound={customSound}
            onVibeChange={setVibe}
            onCustomSoundChange={setCustomSound}
            quiz
          />
        ) : null}

        {quizStep === 2 ? (
          <LockedPreview
            stats={stats}
            soundLabel={soundLabel}
            checkoutState={checkoutState}
            error={error}
            onCheckout={handleCheckout}
            canRevealPrice={canRevealPrice}
            isBusy={isBusy}
            showAction={false}
          />
        ) : null}

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#08070d]/92 px-4 py-3 backdrop-blur-xl sm:hidden">
          <QuizControls
            step={quizStep}
            stats={stats}
            isBusy={isBusy}
            onBack={() => setQuizStep((current) => Math.max(0, current - 1))}
            onNext={() => setQuizStep((current) => Math.min(2, current + 1))}
            onCheckout={handleCheckout}
          />
        </div>

        <div className="hidden border-t border-white/10 pt-5 sm:block">
          <QuizControls
            step={quizStep}
            stats={stats}
            isBusy={isBusy}
            onBack={() => setQuizStep((current) => Math.max(0, current - 1))}
            onNext={() => setQuizStep((current) => Math.min(2, current + 1))}
            onCheckout={handleCheckout}
          />
        </div>
      </FunnelShell>
    );
  }

  return (
    <FunnelShell
      kicker="Message builder"
      title="Add the texts. Then hear the hook."
      subtitle="Build the lyrics message by message so the song keeps their exact words."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
        <div className="space-y-5">
          <MessageComposer
            messages={messages}
            draft={draft}
            stats={stats}
            onDraftChange={setDraft}
            onAdd={addDraft}
            onSample={useSample}
            onUpdate={updateMessage}
            onRemove={removeMessage}
          />
          <VibePicker
            vibe={vibe}
            selectedVibe={selectedVibe}
            customSound={customSound}
            onVibeChange={setVibe}
            onCustomSoundChange={setCustomSound}
          />
        </div>

        <LockedPreview
          stats={stats}
          soundLabel={soundLabel}
          checkoutState={checkoutState}
          error={error}
          onCheckout={handleCheckout}
          canRevealPrice={canRevealPrice}
          isBusy={isBusy}
        />
      </div>
    </FunnelShell>
  );
}

function FunnelShell({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#08070d] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-24 pt-4 sm:px-6 sm:pb-8 lg:px-8">
        <header className="flex h-12 items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-wide text-white">
            SongFromText
          </Link>
          <div className="flex items-center gap-2 text-xs text-white/50">
            <LockKeyhole className="size-3.5" aria-hidden />
            Exact words
          </div>
        </header>

        <section className="grid gap-4 py-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(360px,0.55fr)] lg:items-end lg:py-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-cyan-100/75">
              <MessageSquareText className="size-3.5 text-cyan-200" aria-hidden />
              {kicker}
            </div>
            <h1 className="max-w-3xl text-[2.1rem] font-semibold leading-[1.02] tracking-normal text-white sm:text-5xl lg:text-6xl">
              {title}
            </h1>
          </div>
          <p className="max-w-md text-[14px] leading-6 text-white/58 lg:justify-self-end">
            {subtitle}
          </p>
        </section>

        {children}
      </div>
    </main>
  );
}

function MessageComposer({
  messages,
  draft,
  stats,
  onDraftChange,
  onAdd,
  onSample,
  onUpdate,
  onRemove,
}: {
  messages: string[];
  draft: string;
  stats: MessageStats;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onSample: () => void;
  onUpdate: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className="rounded-[8px] border border-white/10 bg-[#101018] shadow-[0_24px_90px_rgba(0,0,0,0.32)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-medium text-white">Messages</h2>
          <p className="mt-0.5 text-xs text-white/42">{composerStatus(stats)}</p>
        </div>
        <button
          type="button"
          onClick={onSample}
          className="rounded-[8px] border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-pink-300/40 hover:text-white"
        >
          Sample
        </button>
      </div>

      <div className="space-y-2 px-3 py-3 sm:px-4">
        {messages.length ? (
          messages.map((message, index) => (
            <div key={`${index}-${message.slice(0, 8)}`} className="group grid grid-cols-[22px_minmax(0,1fr)_34px] items-start gap-2">
              <div className="flex h-11 items-center justify-center text-white/24">
                <GripVertical className="size-4" aria-hidden />
              </div>
              <Textarea
                value={message}
                onChange={(event) => onUpdate(index, event.target.value)}
                aria-label={`Message ${index + 1}`}
                className={cn(
                  "min-h-11 resize-none rounded-[8px] border-white/10 bg-white/[0.055] px-3 py-2.5 text-[15px] leading-5 text-white shadow-none placeholder:text-white/25 focus-visible:border-cyan-300/45 focus-visible:ring-cyan-300/15",
                  index % 2 === 1 && "bg-pink-400/12",
                )}
              />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`Remove message ${index + 1}`}
                className="flex size-9 items-center justify-center rounded-[8px] text-white/36 transition hover:bg-white/8 hover:text-white"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))
        ) : (
          <div className="grid min-h-32 place-items-center rounded-[8px] border border-dashed border-white/12 bg-black/18 px-6 py-8 text-center">
            <div>
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-[8px] bg-cyan-300/10 text-cyan-100">
                <MessageSquareText className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-medium text-white">Start with one message</p>
              <p className="mt-1 text-xs leading-5 text-white/42">Add more until the preview unlocks.</p>
            </div>
          </div>
        )}

        <div className="rounded-[8px] border border-white/10 bg-black/24 p-2">
          <Label htmlFor="message-draft" className="sr-only">
            Add a message
          </Label>
          <Textarea
            id="message-draft"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onAdd();
              }
            }}
            placeholder="Type or paste a message..."
            className="min-h-20 resize-none border-0 bg-transparent px-2 py-2 text-[16px] leading-6 text-white shadow-none placeholder:text-white/28 focus-visible:ring-0"
          />
          <Button
            type="button"
            onClick={onAdd}
            disabled={!draft.trim()}
            className="mt-1 h-11 w-full rounded-[8px] border border-pink-300/55 bg-pink-400/12 text-[15px] font-semibold text-pink-50 hover:bg-pink-400/18"
          >
            <CirclePlus className="size-4" aria-hidden />
            Add message
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-white/44 sm:px-5">
        <span>{stats.count}/{MIN_MESSAGES} messages</span>
        <span className={stats.tooLong ? "text-red-200" : undefined}>{stats.chars}/{MAX_CHARS} chars</span>
      </div>
    </section>
  );
}

function VibePicker({
  vibe,
  selectedVibe,
  customSound,
  onVibeChange,
  onCustomSoundChange,
  quiz = false,
}: {
  vibe: VibeId;
  selectedVibe: (typeof SONG_VIBES)[number];
  customSound: string;
  onVibeChange: (vibe: VibeId) => void;
  onCustomSoundChange: (sound: string) => void;
  quiz?: boolean;
}) {
  const [isCustomOpen, setIsCustomOpen] = useState(Boolean(customSound));
  const trimmedCustomSound = customSound.trim();

  function addRefinement(refinement: string) {
    setIsCustomOpen(true);
    const currentParts = customSound
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (currentParts.includes(refinement.toLowerCase())) return;

    const next = trimmedCustomSound
      ? `${trimmedCustomSound}, ${refinement}`
      : refinement;
    onCustomSoundChange(next.slice(0, CUSTOM_SOUND_MAX_CHARS));
  }

  return (
    <section className={cn("space-y-3", quiz && "rounded-[8px] border border-white/10 bg-[#101018] p-4 sm:p-5")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-white">Sound</h2>
          <p className="mt-1 text-xs text-white/42">{selectedVibe.badge} / {selectedVibe.detail}</p>
        </div>
        <div className="max-w-[150px] rounded-[8px] border border-cyan-200/18 bg-cyan-300/8 px-3 py-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/54">Selected</p>
          <p className="mt-1 truncate text-xs font-medium text-cyan-50">
            {selectedVibe.label}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SONG_VIBES.map((item, index) => {
          const isSelected = item.id === vibe;
          const isRecommended = index === 0;

          return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onVibeChange(item.id)}
            className={cn(
              "group relative min-h-[132px] overflow-hidden rounded-[8px] border px-3 py-3 text-left transition sm:min-h-[116px] sm:px-3.5",
              isSelected
                ? "border-cyan-200/65 bg-cyan-300/12 text-white shadow-[0_0_28px_rgba(34,211,238,0.14)]"
                : "border-white/10 bg-white/[0.035] text-white/72 hover:border-white/20 hover:bg-white/[0.06]",
            )}
          >
            <span
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-0 transition",
                isSelected && "bg-gradient-to-r from-cyan-200 via-pink-300 to-violet-300 opacity-100",
              )}
            />
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-[15px] font-semibold leading-5">{item.label}</span>
                <span className="mt-1 block text-xs text-white/44">{item.detail}</span>
              </span>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-white/0 transition",
                  isSelected
                    ? "border-cyan-200/70 bg-cyan-200 text-black"
                    : "border-white/12 bg-white/[0.03] group-hover:border-white/22",
                )}
              >
                <Check className="size-3.5" aria-hidden />
              </span>
            </span>
            <span className="mt-4 flex flex-wrap gap-1.5">
              {isRecommended ? (
                <span className="rounded-full border border-pink-200/24 bg-pink-300/12 px-2 py-1 text-[11px] font-medium text-pink-50">
                  Recommended
                </span>
              ) : null}
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/8 bg-black/22 px-2 py-1 text-[11px] text-white/48"
                >
                  {tag}
                </span>
              ))}
            </span>
          </button>
          );
        })}
      </div>

      <div className="rounded-[8px] border border-white/10 bg-black/24">
        <button
          type="button"
          onClick={() => setIsCustomOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-white/[0.035]"
          aria-expanded={isCustomOpen}
          aria-controls="custom-sound-panel"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-white/6 text-cyan-100">
              <SlidersHorizontal className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">Refine sound</span>
              <span className="block truncate text-xs text-white/42">
                {trimmedCustomSound || "Optional details"}
              </span>
            </span>
          </span>
          <span className="text-xs font-medium text-cyan-100/76">
            {isCustomOpen ? "Done" : "Edit"}
          </span>
        </button>

        <div
          id="custom-sound-panel"
          className={cn("space-y-3 border-t border-white/10 p-3", !isCustomOpen && "hidden")}
        >
          <div className="flex flex-wrap gap-1.5">
            {SOUND_REFINEMENTS.map((refinement) => (
              <button
                key={refinement}
                type="button"
                onClick={() => addRefinement(refinement)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/66 transition hover:border-cyan-200/35 hover:text-white"
              >
                {refinement}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="custom-sound" className="text-xs font-medium text-white/72">
                Custom sound
              </Label>
              <span className="text-xs text-white/32">
                {customSound.length}/{CUSTOM_SOUND_MAX_CHARS}
              </span>
            </div>
            <Textarea
              id="custom-sound"
              value={customSound}
              onChange={(event) => onCustomSoundChange(event.target.value)}
              maxLength={CUSTOM_SOUND_MAX_CHARS}
              placeholder="UK R&B with garage drums, smooth vocal, late-night bass"
              className="min-h-20 resize-none rounded-[8px] border-white/10 bg-white/[0.035] px-3 py-2.5 text-[15px] leading-6 text-white shadow-none placeholder:text-white/28 focus-visible:border-cyan-300/45 focus-visible:ring-cyan-300/15"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function LockedPreview({
  stats,
  soundLabel,
  checkoutState,
  error,
  onCheckout,
  canRevealPrice,
  isBusy,
  showAction = true,
}: {
  stats: MessageStats;
  soundLabel: string;
  checkoutState: CheckoutState;
  error: string | null;
  onCheckout: () => void;
  canRevealPrice: boolean;
  isBusy: boolean;
  showAction?: boolean;
}) {
  return (
    <aside className="rounded-[8px] border border-white/10 bg-[#0d0d15] p-4 shadow-[0_30px_120px_rgba(34,211,238,0.08)] sm:p-5 lg:sticky lg:top-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/60">Preview</p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-white">
            {stats.firstLine ? previewTitle(stats.firstLine) : "Waiting for messages"}
          </h2>
        </div>
        <div className="flex size-10 items-center justify-center rounded-[8px] bg-pink-400/14 text-pink-100">
          <Music2 className="size-5" aria-hidden />
        </div>
      </div>

      <div className="mt-5 flex h-24 items-end gap-1 overflow-hidden rounded-[8px] border border-white/8 bg-black/30 px-3 py-4">
        {Array.from({ length: 36 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "w-full rounded-full opacity-85",
              canRevealPrice
                ? "bg-gradient-to-t from-pink-500 via-fuchsia-300 to-cyan-200"
                : "bg-white/18",
            )}
            style={{
              height: `${18 + ((index * 17 + stats.chars) % 62)}%`,
            }}
          />
        ))}
      </div>

      <div className="mt-5 space-y-3 border-t border-white/10 pt-5">
        <PreviewRow label="Messages" value={stats.count ? `${stats.count} added` : "None yet"} complete={stats.hasEnoughMessages} />
        <PreviewRow label="Sound" value={soundLabel} complete />
        <PreviewRow label="Lyrics" value="Exact words" complete={stats.hasMessages} />
      </div>

      {canRevealPrice ? (
        <div className="mt-5 rounded-[8px] border border-cyan-200/18 bg-cyan-300/8 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-cyan-50">
            <Check className="size-4 text-cyan-200" aria-hidden />
            Ready to generate
          </div>
          <p className="mt-2 text-xs leading-5 text-white/50">
            Your first generation starts after Whop confirms checkout.
          </p>
        </div>
      ) : (
        <div className="mt-5 rounded-[8px] border border-white/10 bg-white/[0.035] p-3 text-sm leading-5 text-white/48">
          {previewWaitText(stats)}
        </div>
      )}

      {error ? (
        <p className="mt-4 rounded-[8px] border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      {showAction ? (
        <Button
          type="button"
          size="lg"
          disabled={!canRevealPrice || isBusy}
          onClick={onCheckout}
          className="mt-5 h-12 w-full rounded-[8px] bg-gradient-to-r from-pink-500 to-violet-500 text-base font-semibold text-white shadow-[0_16px_42px_rgba(236,72,153,0.28)] hover:from-pink-400 hover:to-violet-400 disabled:bg-white/10 disabled:shadow-none"
        >
          {checkoutState === "creating" ? (
            "Creating checkout..."
          ) : checkoutState === "redirecting" ? (
            "Opening Whop..."
          ) : canRevealPrice ? (
            <>
              <Sparkles className="size-4" aria-hidden />
              Unlock for £6.99/week
            </>
          ) : (
            "Complete messages first"
          )}
        </Button>
      ) : null}
    </aside>
  );
}

function QuizStepper({ step }: { step: number }) {
  const items = ["Messages", "Sound", "Preview"];

  return (
    <div className="mb-4 grid grid-cols-3 rounded-[8px] border border-white/10 bg-[#101018] p-1">
      {items.map((item, index) => (
        <div
          key={item}
          className={cn(
            "rounded-[6px] px-2 py-2 text-center text-xs font-medium transition",
            index === step ? "bg-white text-black" : index < step ? "text-cyan-100" : "text-white/38",
          )}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function QuizControls({
  step,
  stats,
  isBusy,
  onBack,
  onNext,
  onCheckout,
}: {
  step: number;
  stats: MessageStats;
  isBusy: boolean;
  onBack: () => void;
  onNext: () => void;
  onCheckout: () => void;
}) {
  if (step === 2) {
    return (
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="h-12 rounded-[8px] border-white/10 bg-white/5 text-white hover:bg-white/10">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <Button type="button" disabled={!stats.ready || isBusy} onClick={onCheckout} className="h-12 flex-1 rounded-[8px] bg-gradient-to-r from-pink-500 to-violet-500 text-base font-semibold text-white">
          Unlock for £6.99/week
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={step === 0}
        className="h-12 rounded-[8px] border-white/10 bg-white/5 text-white hover:bg-white/10"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Button>
      <Button
        type="button"
        onClick={onNext}
        disabled={step === 0 && !stats.ready}
        className="h-12 flex-1 rounded-[8px] bg-white text-base font-semibold text-black hover:bg-white/90"
      >
        {step === 0 ? (stats.ready ? "Choose sound" : nextMessageLabel(stats)) : "Preview song"}
        <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  complete,
}: {
  label: string;
  value: string;
  complete: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 text-sm">
      <span className="text-white/48">{label}</span>
      <span className={cn("flex min-w-0 items-center justify-end gap-2 text-right text-white", complete && "text-cyan-50")}>
        {complete ? <Check className="size-3.5 shrink-0 text-cyan-200" aria-hidden /> : null}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function composerStatus(stats: MessageStats): string {
  if (!stats.hasMessages) return "Add messages first";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGES - stats.count} more messages`;
  if (stats.tooLong) return "Trim before checkout";
  if (stats.chars < MIN_CHARS) return "Add a little more";
  return "Preview unlocked";
}

function previewWaitText(stats: MessageStats): string {
  if (!stats.hasMessages) return "Add the messages first.";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGES - stats.count} more messages until the preview step.`;
  if (stats.tooLong) return "Trim the messages before checkout.";
  if (stats.chars < MIN_CHARS) return "Add a little more text before checkout.";
  return "Almost there.";
}

function nextMessageLabel(stats: MessageStats): string {
  if (!stats.hasMessages) return "Add messages";
  if (!stats.hasEnoughMessages) return `${MIN_MESSAGES - stats.count} more`;
  if (stats.chars < MIN_CHARS) return "Add more words";
  if (stats.tooLong) return "Trim messages";
  return "Continue";
}

function previewTitle(line: string): string {
  return line
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, 48)
    .trim();
}
