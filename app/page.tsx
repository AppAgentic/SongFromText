import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-6 py-20 text-white">
      {/* Neon gradient glow backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(236,72,153,0.45),rgba(139,92,246,0.25),transparent)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-20%] right-[-10%] h-[360px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.4),transparent)] blur-3xl"
      />

      <section className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="mb-6 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-white/70 backdrop-blur">
          AI-generated songs from real messages
        </span>

        <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-balance text-4xl font-semibold leading-tight text-transparent sm:text-5xl md:text-6xl">
          Turn their messages into a song.
        </h1>

        <p className="mt-5 max-w-lg text-balance text-base text-white/60 sm:text-lg">
          Paste what they said. Hear it as a real song.
        </p>

        <div className="mt-10">
          <Link
            href="/create"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-12 rounded-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-violet-500 px-8 text-base font-medium text-white shadow-[0_10px_40px_-12px_rgba(236,72,153,0.7)] transition-transform hover:scale-[1.02] hover:from-pink-400 hover:via-fuchsia-400 hover:to-violet-400",
            )}
          >
            Make my song →
          </Link>
        </div>

        <p className="mt-6 text-xs text-white/40">
          £6.99/week · cancel anytime
        </p>
      </section>
    </main>
  );
}
