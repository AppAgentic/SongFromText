"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LockKeyhole, MessageSquareText, Music2, Sparkles } from "lucide-react";
import { signInAnonymously } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { getMetaAttribution, trackMetaPixelEvent } from "@/lib/meta/client";
import { cn } from "@/lib/utils";

const VIBES = [
  { id: "sad-acoustic", label: "Sad acoustic", detail: "soft guitar" },
  { id: "pop-revenge", label: "Pop revenge", detail: "big chorus" },
  { id: "dreamy-synth", label: "Dreamy synth", detail: "late night" },
  { id: "rap-confessional", label: "Rap confessional", detail: "spoken edge" },
  { id: "country-heartbreak", label: "Country heartbreak", detail: "raw twang" },
] as const;

const SAMPLE_LINES = [
  "I know I said I was fine but I was not",
  "You made it sound so easy to leave",
  "I still look for your name when my phone lights up",
  "Maybe that is stupid but it is true",
  "I miss who we were before everything got weird",
].join("\n");

type CheckoutState = "idle" | "creating" | "redirecting";

export default function CreatePage() {
  const [text, setText] = useState("");
  const [vibe, setVibe] = useState<(typeof VIBES)[number]["id"]>("sad-acoustic");
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const trimmed = text.trim();
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      chars: trimmed.length,
      lines: trimmed ? lines.length : 0,
      firstLine: lines[0] ?? "",
      ready: trimmed.length >= 40 && trimmed.length <= 2000 && lines.length >= 5,
    };
  }, [text]);

  const selectedVibe = VIBES.find((item) => item.id === vibe) ?? VIBES[0];
  const isBusy = checkoutState !== "idle";

  async function handleCheckout() {
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
          text,
          vibe,
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

  return (
    <main className="min-h-screen bg-[#06040a] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between py-2">
          <Link href="/" className="text-sm font-semibold tracking-wide text-white">
            SongFromText
          </Link>
          <div className="flex items-center gap-2 text-xs text-white/55">
            <LockKeyhole className="size-3.5" aria-hidden />
            £6.99/week
          </div>
        </header>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
          <div className="space-y-7">
            <div className="max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
                <MessageSquareText className="size-3.5 text-pink-300" aria-hidden />
                Paste their exact messages
              </div>
              <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.02] tracking-normal text-white sm:text-5xl lg:text-6xl">
                Turn the chat into the song they cannot ignore.
              </h1>
              <p className="max-w-xl text-base leading-7 text-white/58">
                Add the messages, choose the mood, then unlock the full song after checkout.
              </p>
            </div>

            <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.35)] sm:p-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="message-text" className="text-sm text-white">
                    Their messages
                  </Label>
                  <p className="text-xs text-white/45">Minimum 5 lines, 40-2000 characters.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setText(SAMPLE_LINES)}
                  className="text-xs font-medium text-pink-200 transition hover:text-pink-100"
                >
                  Use sample
                </button>
              </div>

              <Textarea
                id="message-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste each message on a new line..."
                className="min-h-[240px] resize-none rounded-[8px] border-white/10 bg-black/35 px-4 py-4 text-[15px] leading-6 text-white placeholder:text-white/28 focus-visible:border-pink-300/50 focus-visible:ring-pink-400/15"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/45">
                <span>{stats.lines} lines</span>
                <span>{stats.chars}/2000 characters</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-sm text-white">Vibe</Label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {VIBES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setVibe(item.id)}
                    className={cn(
                      "rounded-[8px] border px-3 py-3 text-left transition",
                      item.id === vibe
                        ? "border-pink-300/60 bg-pink-400/15 text-white shadow-[0_0_28px_rgba(236,72,153,0.18)]"
                        : "border-white/10 bg-white/[0.035] text-white/70 hover:border-white/20 hover:bg-white/[0.06]",
                    )}
                  >
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="mt-1 block text-xs text-white/42">{item.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <aside className="rounded-[8px] border border-white/10 bg-[#0d0913] p-5 shadow-[0_30px_120px_rgba(236,72,153,0.12)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-pink-200/70">Locked preview</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {stats.firstLine ? previewTitle(stats.firstLine) : "Your song preview"}
                </h2>
              </div>
              <div className="flex size-10 items-center justify-center rounded-[8px] bg-pink-400/15 text-pink-100">
                <Music2 className="size-5" aria-hidden />
              </div>
            </div>

            <div className="mb-5 flex h-24 items-end gap-1 overflow-hidden rounded-[8px] border border-white/8 bg-black/30 px-3 py-4">
              {Array.from({ length: 36 }).map((_, index) => (
                <span
                  key={index}
                  className="w-full rounded-full bg-gradient-to-t from-pink-500 to-violet-300 opacity-80"
                  style={{
                    height: `${22 + ((index * 17 + stats.chars) % 58)}%`,
                  }}
                />
              ))}
            </div>

            <div className="space-y-3 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50">Mode</span>
                <span className="text-white">{selectedVibe.label}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50">Lyrics</span>
                <span className="text-white">Exact words</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50">Generation</span>
                <span className="text-white">After payment</span>
              </div>
            </div>

            {error ? (
              <p className="mt-5 rounded-[8px] border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            ) : null}

            <Button
              type="button"
              size="lg"
              disabled={!stats.ready || isBusy}
              onClick={handleCheckout}
              className="mt-5 h-12 w-full rounded-[8px] bg-gradient-to-r from-pink-500 to-violet-500 text-base font-semibold text-white shadow-[0_16px_42px_rgba(236,72,153,0.28)] hover:from-pink-400 hover:to-violet-400"
            >
              {checkoutState === "creating" ? (
                "Creating checkout..."
              ) : checkoutState === "redirecting" ? (
                "Opening Whop..."
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden />
                  Unlock for £6.99/week
                </>
              )}
            </Button>

            <p className="mt-3 text-center text-xs leading-5 text-white/42">
              No music generation starts until Whop confirms checkout.
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}

function previewTitle(line: string): string {
  return line
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, 52)
    .trim();
}
