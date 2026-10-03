import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MOCK_COOKIE, decodeMockSession, isMockAuthEnabled } from "@/lib/mock-auth";
import { isAdminIdentity } from "@/lib/admin-authz";

const adminPrefixes = ["/dashboard", "/panoramas", "/qr", "/routes", "/dataset", "/studio", "/capture"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminRoute = adminPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isLoginPage = pathname === "/login";
  const isAuthCallback = pathname.startsWith("/auth");

  if (isAuthCallback) return NextResponse.next({ request });
  if (!isAdminRoute && !isLoginPage) return NextResponse.next({ request });

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const mockUser = !user && isMockAuthEnabled()
    ? decodeMockSession(request.cookies.get(MOCK_COOKIE)?.value ?? "")
    : null;

  // Canonical server-side admin authorization (shared with API guards).
  // Authentication alone is NOT authorization.
  const isAdmin = Boolean(
    (user && isAdminIdentity({ email: user.email, app_metadata: user.app_metadata as Record<string, unknown> | null })) ||
    (mockUser && isAdminIdentity({ email: mockUser.email, role: mockUser.role })),
  );

  if (!isAdmin && isAdminRoute && !isLoginPage) {
    const url = request.nextUrl.clone();
    // Unauthenticated visitors go to login; authenticated non-admins are sent to
    // the public home (safe state, reveals nothing about other accounts).
    url.pathname = user || mockUser ? "/" : "/login";
    return NextResponse.redirect(url);
  }

  if ((user || mockUser) && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = isAdmin ? "/dashboard" : "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/panoramas/:path*", "/qr/:path*", "/routes/:path*", "/dataset/:path*", "/studio/:path*", "/capture/:path*", "/login", "/auth/:path*"],
};
