/**
 * Project status and paid-generation retry endpoint.
 * The client uses this after Whop redirects back to `/create`.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import {
  refreshProjectGeneration,
  startGenerationForPaidProject,
  type ProjectGenerationSummary,
} from "@/lib/generation";
import { VIBE_VALUES, type VibeId } from "@/lib/vibes";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await requireProjectAuth(req);
  if ("response" in auth) return auth.response;

  const { projectId } = await context.params;
  const db = getAdminDb();
  const projectRef = db.collection("projects").doc(projectId);
  let project = await projectRef.get();

  if (!project.exists) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  if (project.get("ownerId") !== auth.uid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status = getString(project.get("status"));
  const generationStatus = getString(project.get("generationStatus"));
  if (
    (status === "paid" || project.get("subscriptionActive") === true) &&
    (!generationStatus || generationStatus === "not_started")
  ) {
    await startGenerationForPaidProject(db, projectId);
    project = await projectRef.get();
  }

  await refreshProjectGeneration(db, projectId);
  project = await projectRef.get();

  return NextResponse.json({
    project: serializeProject(project.id, project.data()),
  });
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await requireProjectAuth(req);
  if ("response" in auth) return auth.response;

  const { projectId } = await context.params;
  const db = getAdminDb();
  const project = await db.collection("projects").doc(projectId).get();

  if (!project.exists) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  if (project.get("ownerId") !== auth.uid) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (project.get("status") !== "paid" && project.get("subscriptionActive") !== true) {
    return NextResponse.json({ error: "payment_not_confirmed" }, { status: 402 });
  }

  const result = await startGenerationForPaidProject(db, projectId);
  const refreshed = await db.collection("projects").doc(projectId).get();

  return NextResponse.json({
    result,
    project: serializeProject(refreshed.id, refreshed.data()),
  });
}

async function requireProjectAuth(
  req: NextRequest,
): Promise<{ uid: string } | { response: Response }> {
  const token = getBearerToken(req);
  if (!token) {
    return { response: NextResponse.json({ error: "missing_auth" }, { status: 401 }) };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch (error) {
    console.warn("Project auth verification failed", error);
    return { response: NextResponse.json({ error: "invalid_auth" }, { status: 401 }) };
  }
}

function serializeProject(
  id: string,
  data: DocumentData | undefined,
): Record<string, unknown> {
  const generation = asRecord(data?.generation);
  const checkout = asRecord(data?.checkout);

  return compactObject({
    id,
    status: getString(data?.status) ?? "unknown",
    subscriptionActive: data?.subscriptionActive === true,
    subscriptionStatus: getString(data?.subscriptionStatus),
    generationStatus: getString(data?.generationStatus) ?? getString(generation.status) ?? "not_started",
    inputText: getString(data?.inputText),
    email: getString(data?.email),
    vibe: normalizeVibe(data?.vibe),
    customSound: getString(data?.customSound),
    preview: asRecord(data?.preview),
    checkout: {
      priceGbp: getNumber(checkout.priceGbp),
      billingPeriodDays: getNumber(checkout.billingPeriodDays),
    },
    generation: serializeGeneration(generation, data),
  });
}

function serializeGeneration(
  generation: Record<string, unknown>,
  project?: DocumentData,
): ProjectGenerationSummary {
  return compactObject({
    id: getString(generation.id) ?? getString(project?.generationId),
    taskId: getString(generation.taskId) ?? getString(project?.generationTaskId),
    status: getString(generation.status) ?? getString(project?.generationStatus) ?? "not_started",
    audioUrl: getString(generation.audioUrl),
    coverUrl: getString(generation.coverUrl),
    title: getString(generation.title),
    style: getString(generation.style),
    duration: getNumber(generation.duration),
    tracks: Array.isArray(generation.tracks) ? generation.tracks as ProjectGenerationSummary["tracks"] : undefined,
    error: getString(generation.error),
  }) as ProjectGenerationSummary;
}

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

function normalizeVibe(value: unknown): VibeId {
  return typeof value === "string" && VIBE_VALUES.includes(value as VibeId)
    ? value as VibeId
    : "uk-rnb";
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
