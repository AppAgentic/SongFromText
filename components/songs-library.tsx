"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowLeft, Music, RefreshCw } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase/client";

interface SongProject {
  id: string;
  status?: string;
  generationStatus?: string;
  title?: string;
  inputText?: string;
  audioUrl?: string;
  duration?: number;
}

interface ProjectsResponse {
  projects?: SongProject[];
  error?: string;
}

export function SongsLibrary() {
  const [projects, setProjects] = useState<SongProject[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "signed_out" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setStatus("signed_out");
        return;
      }

      void loadProjects(user);
    });

    async function loadProjects(user: User): Promise<void> {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/projects", {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        const payload = await readJson<ProjectsResponse>(response);
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not load songs.");
        }

        setProjects(payload.projects ?? []);
        setStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load songs.");
        setStatus("error");
      }
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#fffaf5] px-5 py-6 text-[#241b25]">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/create"
            className="grid size-11 place-items-center rounded-full bg-white text-[#241b25] shadow-[0_12px_30px_rgba(42,32,24,0.08)]"
            aria-label="Back to creator"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <p className="rounded-full bg-[#f4dfe7] px-4 py-2 text-sm font-semibold text-[#a43363]">
            My Songs
          </p>
        </div>

        <div className="mt-10">
          <h1 className="font-serif text-5xl leading-tight">Your songs</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-[#675b61]">
            Songs created from this browser will appear here after checkout and generation.
          </p>
        </div>

        {status === "loading" ? (
          <EmptyState icon={<RefreshCw className="size-6 animate-spin" />} title="Loading songs" />
        ) : null}

        {status === "signed_out" ? (
          <EmptyState
            icon={<Music className="size-6" />}
            title="No saved session yet"
            description="Create a song first, then return here from the same browser."
          />
        ) : null}

        {status === "error" ? (
          <EmptyState
            icon={<Music className="size-6" />}
            title="Could not load songs"
            description={error ?? "Try refreshing in a moment."}
          />
        ) : null}

        {status === "ready" && !projects.length ? (
          <EmptyState
            icon={<Music className="size-6" />}
            title="No songs yet"
            description="Start with a few messages and unlock your first song."
          />
        ) : null}

        {projects.length ? (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <article
                key={project.id}
                className="rounded-[24px] border border-[#eadfd7] bg-white p-5 shadow-[0_18px_54px_rgba(42,32,24,0.08)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9c7b83]">
                      {project.generationStatus ?? project.status ?? "saved"}
                    </p>
                    <h2 className="mt-2 line-clamp-2 font-serif text-2xl leading-tight">
                      {project.title ?? previewTitle(project.inputText) ?? "Their message song"}
                    </h2>
                  </div>
                  <Link
                    href={`/create?checkout=return&projectId=${encodeURIComponent(project.id)}`}
                    className="rounded-full bg-[#241b25] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open
                  </Link>
                </div>

                {project.audioUrl ? (
                  <audio controls src={project.audioUrl} className="mt-5 w-full" />
                ) : (
                  <p className="mt-5 rounded-[16px] bg-[#f7f0ea] px-4 py-3 text-sm leading-6 text-[#675b61]">
                    Audio is still processing or needs a retry.
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="mt-10 rounded-[28px] border border-[#eadfd7] bg-white p-8 text-center shadow-[0_18px_54px_rgba(42,32,24,0.08)]">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-[#f4dfe7] text-[#a43363]">
        {icon}
      </div>
      <h2 className="mt-4 font-serif text-3xl">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#675b61]">{description}</p>
      ) : null}
    </div>
  );
}

function previewTitle(text: string | undefined): string | undefined {
  return text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[^:]{1,24}:\s*/, "")
    .slice(0, 64);
}

async function readJson<T extends { error?: string }>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: `Server returned ${response.status}.` } as T;
  }
}
