# Supabase Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock auth with Supabase Auth using @supabase/ssr for sessions and Google OAuth.

**Architecture:** @supabase/ssr handles cookie-based sessions for client, server components, and middleware. @supabase/server handles JWT verification for API routes. Login uses Supabase OAuth flow with Google provider.

**Tech Stack:** Next.js 16 App Router, @supabase/ssr, @supabase/supabase-js, @supabase/server, Google OAuth

**Global Constraints**
- Must use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser client
- Must use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server-side admin
- Auth cookie name controlled by @supabase/ssr defaults
- Mock auth files must be deleted, not commented out

---

### Task 1: Install dependency + create client files

**Files:**
- Create: `src/lib/supabase-client.ts`
- Modify: `src/lib/supabase-server.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (env vars)
- Produces: `createClient()` function in `supabase-client.ts`, rewritten `createServerClient()` in `supabase-server.ts`

- [ ] **Step 1: Install @supabase/ssr**

```bash
npm install @supabase/ssr
```

- [ ] **Step 2: Create `src/lib/supabase-client.ts`**

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3: Rewrite `src/lib/supabase-server.ts`**

Replace the existing singleton admin client with @supabase/ssr's `createServerClient` for cookie-based requests and keep the admin client for non-request contexts:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    },
  );
}
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 2: Create middleware

**Files:**
- Create: `src/middleware.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (env vars)
- Produces: Next.js middleware that protects `/admin/*` routes

- [ ] **Step 1: Create `src/middleware.ts`**

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/admin/login";

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 3: Create OAuth callback route

**Files:**
- Create: `src/app/auth/callback/route.ts`

**Interfaces:**
- Produces: Route handler that exchanges OAuth code for session and redirects to dashboard

- [ ] **Step 1: Create `src/app/auth/callback/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin/dashboard";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth_failed`);
}
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 4: Rewrite AuthProvider + update useAuth + types

**Files:**
- Modify: `src/components/providers/AuthProvider.tsx`
- Modify: `src/hooks/useAuth.ts`
- Modify: `src/types/user.ts`

**Interfaces:**
- Consumes: Supabase session from `createClient()`
- Produces: `AuthProvider` providing `user`, `session`, `signOut` via context

- [ ] **Step 1: Update `src/types/user.ts`**

Remove `login` and `logout` from `AuthState` — those become Supabase SDK calls:

```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "campus_admin" | "mapping_staff" | "viewer";
  campus_id: string | null;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
}
```

- [ ] **Step 2: Update `src/hooks/useAuth.ts`**

```typescript
import { createContext, useContext } from "react";
import type { AuthState } from "@/types/user";

export const AuthContext = createContext<AuthState>({
  user: null,
  isAuthenticated: false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 3: Rewrite `src/components/providers/AuthProvider.tsx`**

```typescript
"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { AuthContext } from "@/hooks/useAuth";
import { createClient } from "@/lib/supabase-client";
import type { User } from "@/types/user";
import type { Session } from "@supabase/supabase-js";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        setUser({
          id: session.user.id,
          name: session.user.user_metadata?.full_name ?? session.user.email ?? "",
          email: session.user.email ?? "",
          role: session.user.user_metadata?.role ?? "viewer",
          campus_id: session.user.user_metadata?.campus_id ?? null,
        });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        setUser({
          id: session.user.id,
          name: session.user.user_metadata?.full_name ?? session.user.email ?? "",
          email: session.user.email ?? "",
          role: session.user.user_metadata?.role ?? "viewer",
          campus_id: session.user.user_metadata?.campus_id ?? null,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 5: Update login page + delete mock data

**Files:**
- Modify: `src/app/(admin)/login/page.tsx`
- Delete: `src/data/users.ts`

- [ ] **Step 1: Update `src/app/(admin)/login/page.tsx`**

```typescript
"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase-client";

export default function LoginPage() {
  const handleGoogleLogin = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold">NAVI Admin</h1>
        <p className="text-muted-foreground">Sign in to continue</p>
        <button
          onClick={handleGoogleLogin}
          className="inline-flex items-center gap-2 rounded-lg border px-6 py-3 hover:bg-muted"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete `src/data/users.ts`**

```bash
Remove-Item -LiteralPath "src\data\users.ts" -Force
```

- [ ] **Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 6: Clean up admin layout

**Files:**
- Modify: `src/app/(admin)/layout.tsx`

- [ ] **Step 1: Remove client-side auth redirect from admin layout**

Replace the current layout — middleware handles redirects now:

```typescript
"use client";

import { usePathname, useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import type { ScreenName } from "@/types/screens";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const segments = pathname.split("/").filter(Boolean);
  const currentScreen: ScreenName = (segments[segments.length - 1] as ScreenName) || "dashboard";

  const handleNavigate = (screen: ScreenName) => {
    router.push(`/admin/${screen}`);
  };

  return (
    <AppLayout currentScreen={currentScreen} onNavigate={handleNavigate}>
      {children}
    </AppLayout>
  );
}
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: 0 errors (pre-existing warnings only)

---

### Task 7: Enable Google OAuth in Supabase dashboard

- [ ] **Step 1: Open Supabase dashboard → Authentication → Providers → Google → Enable**

Set the Client ID and Client Secret from Google Cloud Console.

- [ ] **Step 2: Add the callback URL to Google Cloud Console**

In Google Cloud Console → APIs & Services → Credentials → Your OAuth 2.0 Client:
Add `https://oltfaepqcktrumfhadzb.supabase.co/auth/v1/callback` as an authorized redirect URI.
