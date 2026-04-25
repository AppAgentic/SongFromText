import Link from "next/link";
import { ArrowRight, MessageSquareText, Music2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PREVIEW_MESSAGES = [
  "I miss how we used to talk at night",
  "You always knew the right thing to say",
  "I still replay that last voice note",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#08070d] text-white">
      <section className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_410px] lg:px-8">
        <div className="space-y-8">
          <header className="flex items-center justify-between lg:block">
            <Link href="/" className="text-sm font-semibold tracking-wide text-white">
              SongFromText
            </Link>
            <Link href="/quiz" className="text-xs font-medium text-white/50 transition hover:text-white lg:hidden">
              Quiz flow
            </Link>
          </header>

          <div className="max-w-2xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-cyan-100/75">
              <MessageSquareText className="size-3.5 text-cyan-200" aria-hidden />
              Real messages, exact words
            </div>
            <h1 className="text-[3.1rem] font-semibold leading-[0.95] tracking-normal text-white sm:text-7xl">
              Turn their texts into a song.
            </h1>
            <p className="max-w-md text-[16px] leading-7 text-white/58">
              Add the messages one by one. Pick the mood. Preview the hook before checkout.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/create"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-12 rounded-[8px] bg-white px-5 text-base font-semibold text-black hover:bg-white/90",
              )}
            >
              Start with messages
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/quiz"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-12 rounded-[8px] border-white/10 bg-white/[0.04] px-5 text-base font-semibold text-white hover:bg-white/[0.08]",
              )}
            >
              Try quiz version
            </Link>
          </div>
        </div>

        <div className="rounded-[8px] border border-white/10 bg-[#101018] p-4 shadow-[0_30px_120px_rgba(34,211,238,0.08)]">
          <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/60">Live flow</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Message builder</h2>
            </div>
            <div className="flex size-10 items-center justify-center rounded-[8px] bg-pink-400/14 text-pink-100">
              <Music2 className="size-5" aria-hidden />
            </div>
          </div>

          <div className="space-y-2">
            {PREVIEW_MESSAGES.map((message, index) => (
              <div
                key={message}
                className={cn(
                  "rounded-[8px] border border-white/10 px-3 py-2.5 text-sm leading-5 text-white",
                  index % 2 ? "ml-8 bg-pink-400/14" : "mr-8 bg-white/[0.055]",
                )}
              >
                {message}
              </div>
            ))}
          </div>

          <div className="mt-5 flex h-20 items-end gap-1 overflow-hidden rounded-[8px] border border-white/8 bg-black/30 px-3 py-4">
            {Array.from({ length: 32 }).map((_, index) => (
              <span
                key={index}
                className="w-full rounded-full bg-gradient-to-t from-pink-500 via-fuchsia-300 to-cyan-200 opacity-85"
                style={{ height: `${18 + ((index * 19) % 62)}%` }}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
