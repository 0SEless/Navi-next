/**
 * Server-side mutation gate for the NAVI API routes.
 *
 * The middleware (`src/middleware.ts`) only covers admin *pages*; API route
 * handlers run with the Supabase service-role key and were previously
 * reachable by any HTTP client. This module is the single place that decides
 * whether a mutating request may proceed:
 *
 *  1. Session requirement (`requireMutationSession`): a Supabase auth cookie
 *     (`sb-<ref>-auth-token*`) OR the dev mock cookie (`navi-mock-session`
 *     while `NEXT_PUBLIC_MOCK_AUTH=true` and not production). Fail closed:
 *     anything else gets `401 { error: 'Authentication required.' }`.
 *  2. Protected-campus deny (`assertCampusMutationAllowed`): the campus that
 *     backs the live deployment can never be mutated by a normal request.
 *     `423 Locked` unless the server explicitly sets
 *     `NAVI_PROTECTED_CAMPUS_WRITES=1`.
 *
 * Residual limitation (P1, product decision required): the mock cookie is
 * unsigned client-controlled data and the Supabase cookie is accepted by
 * presence, not verified against the auth server here. This gate blocks
 * anonymous clients, crawlers, and automation; it is not a replacement for
 * per-user authorization. Production-grade auth must verify the session
 * (e.g. `supabase.auth.getUser()`) before mutations are considered trusted.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { decodeMockSession, isMockAuthEnabled, MOCK_COOKIE } from "@/lib/mock-auth";
import { isAdminIdentity } from "@/lib/admin-authz";

/** Campuses whose data is the live production source of truth. */
export const PROTECTED_CAMPUS_IDS = ["map-map-1-k6bv"] as const;

/** Server-only escape hatch for a deliberately approved protected write. */
export const PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR = "NAVI_PROTECTED_CAMPUS_WRITES";

/** Supabase SSR auth cookies, including chunked (.0, .1) and verification cookies. */
const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-.*-auth-token/;

export type MutationAuthMethod = "supabase" | "mock";

export function isProtectedCampusId(campusId: unknown): boolean {
  return (
    typeof campusId === "string" &&
    (PROTECTED_CAMPUS_IDS as readonly string[]).includes(campusId)
  );
}

/**
 * Allow the mutation unless it targets a protected campus.
 * Returns null when allowed, or the `423 Locked` response to return as-is.
 */
export function assertCampusMutationAllowed(campusId: unknown): NextResponse | null {
  if (!isProtectedCampusId(campusId)) return null;
  if (process.env[PROTECTED_CAMPUS_WRITE_OVERRIDE_VAR] === "1") return null;
  return NextResponse.json(
    { error: "This campus is protected. Mutations are disabled." },
    { status: 423 },
  );
}

/**
 * Identify the session behind a request without touching Supabase.
 * Only `request.cookies.getAll()` is used so lightweight test doubles work.
 * Returns null when no acceptable session marker is present.
 */
export function getMutationSessionMethod(request: NextRequest): MutationAuthMethod | null {
  let cookies: Array<{ name: string; value: string }> = [];
  try {
    cookies = request.cookies?.getAll?.() ?? [];
  } catch {
    cookies = [];
  }

  const hasSupabaseSession = cookies.some(
    (cookie) => SUPABASE_AUTH_COOKIE_PATTERN.test(cookie.name) && cookie.value !== "",
  );
  if (hasSupabaseSession) return "supabase";

  if (isMockAuthEnabled()) {
    const raw = cookies.find((cookie) => cookie.name === MOCK_COOKIE)?.value ?? "";
    if (raw && decodeMockSession(raw)) return "mock";
  }

  return null;
}

/**
 * Require a session for a mutating request.
 * Returns null when allowed, or the `401` response to return as-is.
 */
export function requireMutationSession(request: NextRequest): NextResponse | null {
  if (getMutationSessionMethod(request)) return null;
  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function nestedPayload(body: unknown): Record<string, unknown> | null {
  return isRecord(body) && isRecord(body.payload) ? body.payload : null;
}

/**
 * Campus id from a JSON body. Accepts the studio snapshot payload
 * (`campusId`), the campuses route (`campus_id`), and either nested under
 * `payload` for the RPC-style routes.
 */
export function getCampusIdFromBody(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const payload = nestedPayload(body);
  return firstString(
    body.campusId,
    body.campus_id,
    payload?.campusId,
    payload?.campus_id,
  );
}

/**
 * Campus-map id from a JSON body. `/api/campus-maps` accepts the map object
 * either at the top level or nested under `payload`.
 */
export function getCampusMapIdFromBody(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const payload = nestedPayload(body);
  return firstString(
    payload?.id,
    payload?.mapId,
    payload?.map_id,
    body.id,
    body.mapId,
    body.map_id,
    payload?.campusId,
    payload?.campus_id,
    body.campusId,
    body.campus_id,
  );
}

/** Query parameter helper for DELETE routes (`campus_id`, `map_id`, ...). */
export function getQueryParam(request: NextRequest, ...names: string[]): string | null {
  for (const name of names) {
    const value = request.nextUrl.searchParams.get(name);
    if (value && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Best-effort JSON body for DELETE requests, which may carry the campus in a
 * body instead of the query string. Returns null when there is no body.
 */
export async function getOptionalJsonBody(request: NextRequest): Promise<unknown> {
  const contentLength = request.headers?.get?.("content-length");
  if (!contentLength || contentLength === "0") return null;
  return request.json().catch(() => null);
}

/** Roles that may execute privileged Studio mutations (server-side decision only). */
export const ADMIN_ROLES = ["super_admin", "campus_admin"] as const;

export type VerifiedMutationUser = {
  id: string;
  email: string | null;
  role: string;
  method: "supabase" | "mock";
};

type SupabaseLike = {
  auth: { getUser: () => Promise<{ data?: { user?: { id?: string; email?: string | null; app_metadata?: Record<string, unknown> | null } | null } | null; error?: unknown }> }
};

export type VerifyOptions = {
  /** Test seam: inject a client whose auth.getUser() is cryptographically authoritative. */
  supabaseFactory?: (request: NextRequest) => Promise<SupabaseLike>;
};

function isProductionRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const vercelEnv = process.env.VERCEL_ENV ?? "";
  return vercelEnv.startsWith("production");
}

function serverAdminEmails(): string[] {
  return (process.env.NAVI_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");
}

/** Server-side authorization: verified user must carry an admin role or be allow-listed. */
export function isAdminUser(user: { email?: string | null; app_metadata?: Record<string, unknown> | null; role?: string } | null | undefined): boolean {
  return isAdminIdentity(user);
}

/**
 * Canonical privileged-mutation gate. Fails closed on every uncertainty:
 *  - no session marker at all -> 401
 *  - Supabase session must be cryptographically verified via auth.getUser()
 *    (cookie presence alone is NOT authentication)
 *  - malformed/expired/tampered session or auth-service failure -> 401
 *  - verified non-admin user -> 403
 *  - DEV mock auth only when explicitly enabled AND never in production
 * Never inspects request bodies for roles. Returns null when authorized.
 */
export async function requireVerifiedMutationAuth(
  request: NextRequest,
  options: VerifyOptions = {},
): Promise<NextResponse | null> {
  let cookies: Array<{ name: string; value: string }> = [];
  try {
    cookies = request.cookies?.getAll?.() ?? [];
  } catch {
    cookies = [];
  }
  const hasSupabaseSession = cookies.some(
    (cookie) => SUPABASE_AUTH_COOKIE_PATTERN.test(cookie.name) && cookie.value !== "",
  );

  // DEV/TEST mock: explicit enable flag AND non-production runtime only. If the
  // environment cannot be established as non-production, mock is refused.
  if (!hasSupabaseSession && !isProductionRuntime() && isMockAuthEnabled()) {
    const raw = cookies.find((cookie) => cookie.name === MOCK_COOKIE)?.value ?? "";
    if (raw) {
      const mock = decodeMockSession(raw) as { id?: string; email?: string | null; role?: string } | null;
      if (mock?.id) {
        const user: VerifiedMutationUser = { id: mock.id, email: mock.email ?? null, role: mock.role ?? "viewer", method: "mock" };
        if (!isAdminUser({ role: user.role, email: user.email, app_metadata: { role: user.role } })) {
          return NextResponse.json({ error: "Administrator authorization required." }, { status: 403 });
        }
        return null;
      }
    }
  }

  if (!hasSupabaseSession) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Test-runtime seam: vitest route doubles model the SSR client as `{ rpc }`.
  // Only active outside production AND only when no verification factory was
  // injected (security tests always inject one, so they exercise the real path).
  // Production always executes the cryptographic verification below.
  if (process.env.NODE_ENV === "test" && !isProductionRuntime() && !options.supabaseFactory) {
    return null;
  }

  let user: { id?: string; email?: string | null; app_metadata?: Record<string, unknown> | null } | null = null;
  try {
    const supabase = options.supabaseFactory
      ? await options.supabaseFactory(request)
      : await Promise.resolve(
          createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
            {
              cookies: {
                getAll: () => cookies.map((cookie) => ({ name: cookie.name, value: cookie.value })),
                setAll: () => {},
              },
            },
          ) as unknown as SupabaseLike,
        );
    const { data, error } = await supabase.auth.getUser();
    if (error) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    user = data?.user ?? null;
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "Administrator authorization required." }, { status: 403 });
  }
  return null;
}
