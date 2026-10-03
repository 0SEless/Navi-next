# Supabase Auth — Design Doc

**Date:** 2026-06-20
**Project:** NAVI (navi-next)

## Overview

Replace mock auth with Supabase Auth using `@supabase/ssr` for client-side session management and `@supabase/server` for API route JWT verification. Add Google OAuth login.

## Architecture

### File Structure

```
src/
  lib/
    supabase-client.ts         ← NEW: createBrowserClient
    supabase-server.ts         ← REWRITE: createServerClient (cookie-based)
  app/
    auth/
      callback/route.ts        ← NEW: OAuth redirect handler
    login/page.tsx              ← UPDATE: Google OAuth button
  middleware.ts                 ← NEW: route protection, session refresh
  components/
    providers/
      AuthProvider.tsx          ← REWRITE: use Supabase session
  hooks/
    useAuth.ts                  ← UPDATE: match Supabase shape
  data/
    users.ts                    ← DELETE: no longer needed
  types/
    user.ts                     ← UPDATE: remove login/logout from AuthState
```

### Dependencies

- Install `@supabase/ssr` (client/server/middleware helpers)
- Keep `@supabase/supabase-js` (peer dep)
- Keep `@supabase/server` (API route auth)

## Auth Flow

1. **Login:** User clicks "Sign in with Google" → `supabase.auth.signInWithOAuth({ provider: 'google' })` → Google redirect → auth code returned to `/auth/callback`
2. **Callback:** `createServerClient` reads code, sets session cookie, redirects to `/admin/dashboard`
3. **Middleware:** Reads cookie on every request, refreshes session, protects `/admin/*` routes
4. **AuthProvider:** Reads session client-side with `supabase.auth.getSession()`, provides `user` + `signOut`
5. **Logout:** `supabase.auth.signOut()` → clears cookie → middleware redirects to `/login`

## Route Protection

| Route | Auth Required | Behavior |
|-------|--------------|----------|
| `/admin/*` | Yes | Middleware redirects to `/login` if no session |
| `/admin/login` | No | Always accessible |
| `/map/*`, `/api/*` | No | Public (API routes use `@supabase/server` with per-endpoint auth) |

## Data Flow

| Layer | Tool | Credential Source |
|-------|------|------------------|
| Middleware | `@supabase/ssr` `createServerClient` | Request cookies |
| Server components | `@supabase/ssr` `createServerClient` | `cookies()` API |
| API routes | `@supabase/server` `withSupabase` | `Authorization: Bearer <JWT>` |
| Client | `@supabase/ssr` `createBrowserClient` | Cookie (auto) |

## Migration Steps

1. `npm install @supabase/ssr`
2. Create `src/lib/supabase-client.ts` — `createBrowserClient` with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Rewrite `src/lib/supabase-server.ts` — `createServerClient` reading cookies from the request
4. Create `src/middleware.ts` — refresh session, protect `/admin/*`
5. Create `src/app/auth/callback/route.ts` — exchange code for session
6. Rewrite `src/components/providers/AuthProvider.tsx` — use Supabase session
7. Update `src/hooks/useAuth.ts` — align with Supabase session shape
8. Update `src/app/(admin)/login/page.tsx` — Google OAuth button
9. Delete `src/data/users.ts`
10. Remove client-side redirect from `src/app/(admin)/layout.tsx`
11. Enable Google OAuth in Supabase dashboard

## What's Removed

- Mock users (`src/data/users.ts`)
- Mock auth provider (localStorage-based session)
- Client-side redirect in admin layout (`useEffect` → `router.replace`)
