/**
 * Canonical NAVI admin authorization policy.
 *
 * ONE shared implementation used by BOTH the page middleware and the API
 * guards so route authorization and API authorization can never drift:
 *   - role claim: app_metadata.role in { super_admin, campus_admin }
 *   - optional server-side allowlist: NAVI_ADMIN_EMAILS (comma separated)
 * Never consults client-supplied data, cookies (beyond the verified session),
 * local storage, or display labels.
 */
export const ADMIN_ROLES = ["super_admin", "campus_admin"] as const;

export type AdminIdentity = {
  email?: string | null;
  role?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

export function isAdminIdentity(
  user: AdminIdentity | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!user) return false;
  const claimedRole =
    typeof user.app_metadata?.role === "string"
      ? (user.app_metadata.role as string)
      : user.role;
  if (typeof claimedRole === "string" && (ADMIN_ROLES as readonly string[]).includes(claimedRole)) {
    return true;
  }
  const email = typeof user.email === "string" ? user.email.toLowerCase() : "";
  const allow = (env.NAVI_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");
  return email !== "" && allow.includes(email);
}
