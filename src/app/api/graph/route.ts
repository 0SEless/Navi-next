import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  assertCampusMutationAllowed,
  getCampusIdFromBody,
  requireVerifiedMutationAuth,
} from "@/lib/api-guard";

const RPC_TIMEOUT_MS = 30000

type MutationOutcome =
  | "SUCCESS"
  | "REPLAY"
  | "CAS_CONFLICT"
  | "MUTATION_COLLISION"
  | "INVALID_REQUEST"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "UNKNOWN"

function logMutationLifecycle(entry: {
  requestId: string
  mutationId: string | null
  campusId: string | null
  expectedRevision: string | null
  durationMs: number
  outcome: MutationOutcome
  status: number
}): void {
  // Structured lifecycle log. Never includes the graph payload or credentials.
  console.log(`[api/graph] lifecycle ${JSON.stringify(entry)}`)
}

function isAbortLike(error: unknown, controller: AbortController): boolean {
  if (controller.signal.aborted) return true
  const name = (error as { name?: string } | null)?.name
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? "")
  return name === "AbortError" || /abort/i.test(message)
}

export async function getClient(auth: "publishable" | "secret", signal?: AbortSignal) {
  const key = auth === "secret"
    ? process.env.SUPABASE_SERVICE_ROLE_KEY!
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
      // The per-request AbortSignal must reach the real network fetch so a
      // timed-out request stops occupying a connection instead of leaking.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...(init ?? {}), signal }),
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const supabase = await getClient("publishable");
  const { searchParams } = new URL(request.url);
  const campusId = searchParams.get("campus_id");

  if (!campusId) {
    return NextResponse.json({ error: "campus_id is required" }, { status: 400 });
  }

  const result = await supabase
    .from("graph_snapshots")
    .select("data, authored_document, updated_at")
    .eq("campus_id", campusId)
    .maybeSingle() as unknown as {
      data: { data: unknown; authored_document?: unknown; updated_at?: string } | null
      error: { message: string } | null
    };

  if (result.error) {
    console.error(`[api/graph] graph_snapshots query failed for campus "${campusId}":`, result.error);
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  if (result.data?.data) {
    const response: Record<string, unknown> = {
      ...(result.data.data as Record<string, unknown>),
      updatedAt: result.data.updated_at ?? null,
    }
    if (result.data.authored_document !== null && result.data.authored_document !== undefined) {
      response.authoredDocumentFormatVersion = 1
      response.authoredDocument = result.data.authored_document
    }
    return NextResponse.json(response);
  }

  return NextResponse.json({
    version: "1.0.0",
    campusId: campusId,
    buildings: [],
    nodes: [],
    edges: [],
    components: [],
    exportedAt: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const requestId = (globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let mutationId: string | null = null;
  let campusId: string | null = null;
  let expectedRevision: string | null = null;
  let outcome: MutationOutcome = "UNKNOWN";
  let status = 500;

  try {
    const unauthorized = await requireVerifiedMutationAuth(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    mutationId = typeof body?.mutationId === "string" ? body.mutationId : null;
    campusId = getCampusIdFromBody(body) ?? null;
    expectedRevision = typeof body?.expectedServerUpdatedAt === "string" ? body.expectedServerUpdatedAt : null;

    if (!campusId) {
      outcome = "INVALID_REQUEST";
      status = 400;
      return NextResponse.json({ error: "campusId is required" }, { status });
    }

    const blocked = assertCampusMutationAllowed(campusId);
    if (blocked) return blocked;

    const supabase = await getClient("secret", controller.signal);
    // Prefer the idempotent RPC (migration 011); fall back until it is rolled out.
    let { data: result, error: rpcError } = await supabase.rpc("sync_graph_snapshot_idempotent", { payload: body });
    if (
      rpcError &&
      !controller.signal.aborted &&
      /could not find the function|does not exist|PGRST202/i.test(`${rpcError.message ?? ""} ${rpcError.details ?? ""}`)
    ) {
      const fallback = await supabase.rpc("sync_graph_snapshot", { payload: body });
      result = fallback.data;
      rpcError = fallback.error;
    }

    if (rpcError) {
      // Normalize the RPC error. postgrest-js can surface two shapes:
      //  1. A wrapped fetch failure — `message` = "TypeError: fetch failed",
      //     `details` = "TypeError: fetch failed\n\nCaused by: TypeError: fetch failed (ECONNREFUSED)"
      //  2. A malformed/empty error object (`{}`) from an upstream 5xx with a
      //     non-JSON body — all fields undefined. Prefer the wrapped cause so
      //     the client's network-error detection actually works; fall back to
      //     a stable generic message otherwise.
      const errMsg = rpcError.message || rpcError.details || "Supabase RPC failed";
      console.error("[api/graph] sync_graph_snapshot RPC failed:", {
        message: rpcError.message ?? null,
        code: rpcError.code ?? null,
        hint: rpcError.hint ?? null,
        details: rpcError.details ?? null,
      });
      if (isAbortLike(rpcError, controller)) {
        outcome = "TIMEOUT";
        status = 504;
        return NextResponse.json(
          { error: "The save request timed out on the server. It was NOT retried; local changes are preserved and the next save will re-check the authoritative revision." },
          { status: 504 },
        );
      }
      if (errMsg.includes("GRAPH_SNAPSHOT_CONFLICT")) {
        outcome = "CAS_CONFLICT";
        status = 409;
        return NextResponse.json({ error: "The server changed since this editor loaded it. Your local changes were not overwritten." }, { status: 409 });
      }
      if (errMsg.includes("MUTATION_ID_COLLISION")) {
        outcome = "MUTATION_COLLISION";
        status = 409;
        return NextResponse.json({ error: "Mutation id collision: this save identity was already used with different content." }, { status: 409 });
      }
      outcome = "UPSTREAM_ERROR";
      status = 500;
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    const replay = Boolean((result as { idempotent_replay?: boolean } | null)?.idempotent_replay);
    outcome = replay ? "REPLAY" : "SUCCESS";
    status = 200;
    return NextResponse.json((result ?? { success: true }) as Record<string, unknown>);
  } catch (e) {
    if (isAbortLike(e, controller)) {
      outcome = "TIMEOUT";
      status = 504;
      return NextResponse.json(
        { error: "The save request timed out on the server. It was NOT retried; local changes are preserved and the next save will re-check the authoritative revision." },
        { status: 504 },
      );
    }
    const msg = e instanceof Error ? e.message : "Invalid request";
    console.error("[api/graph] POST handler error:", e);
    outcome = "UNKNOWN";
    status = 400;
    return NextResponse.json({ error: msg }, { status: 400 });
  } finally {
    clearTimeout(timeoutTimer);
    logMutationLifecycle({
      requestId,
      mutationId,
      campusId,
      expectedRevision,
      durationMs: Date.now() - startedAt,
      outcome,
      status,
    });
  }
}
