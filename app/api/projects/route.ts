/**
 * Current user's project/song list.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "missing_auth" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (error) {
    console.warn("Projects auth verification failed", error);
    return NextResponse.json({ error: "invalid_auth" }, { status: 401 });
  }

  const snapshot = await getAdminDb()
    .collection("projects")
    .where("ownerId", "==", uid)
    .limit(25)
    .get();

  const projects = snapshot.docs
    .map((doc) => serializeProject(doc.id, doc.data()))
    .sort((a, b) => getSortableTime(b) - getSortableTime(a));

  return NextResponse.json({ projects });
}

function serializeProject(id: string, data: DocumentData): Record<string, unknown> {
  const generation = asRecord(data.generation);
  const preview = asRecord(data.preview);

  return compactObject({
    id,
    status: getString(data.status),
    generationStatus: getString(data.generationStatus) ?? getString(generation.status),
    inputText: getString(data.inputText),
    email: getString(data.email),
    vibe: getString(data.vibe),
    title: getString(generation.title) ?? getString(preview.title),
    audioUrl: getString(generation.audioUrl),
    coverUrl: getString(generation.coverUrl),
    duration: getNumber(generation.duration),
    updatedAtMs: getTimestampMs(data.updatedAt),
    createdAtMs: getTimestampMs(data.createdAt),
  });
}

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

function getSortableTime(project: Record<string, unknown>): number {
  return getNumber(project.updatedAtMs) ?? getNumber(project.createdAtMs) ?? 0;
}

function getTimestampMs(value: unknown): number | undefined {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
