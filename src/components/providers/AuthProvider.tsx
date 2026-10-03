"use client";

import { useState, useEffect, type ReactNode } from "react";
import { createClient } from "@/lib/supabase-client";
import { AuthContext } from "@/hooks/useAuth";
import { decodeMockSession, isMockAuthEnabled, MOCK_COOKIE } from "@/lib/mock-auth";
import type { User } from "@/types/user";

function mapSupabaseUser(sbUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): User {
  return {
    id: sbUser.id,
    name: (sbUser.user_metadata?.full_name as string) || sbUser.email || "Unknown",
    email: sbUser.email || "",
    role: (sbUser.user_metadata?.role as User["role"]) || "viewer",
    campus_id: (sbUser.user_metadata?.campus_id as string) || null,
  };
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUser(mapSupabaseUser(session.user));
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(mapSupabaseUser(session.user));
        setIsAuthenticated(true);
      } else if (isMockAuthEnabled()) {
        const raw = getCookie(MOCK_COOKIE);
        if (raw) {
          const mockUser = decodeMockSession(raw);
          if (mockUser) {
            setUser(mockUser);
            setIsAuthenticated(true);
          }
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const mockLogin = async (mockUser: import("@/lib/mock-auth").MockUser) => {
    const { encodeMockSession } = await import("@/lib/mock-auth");
    const encoded = encodeMockSession(mockUser);
    document.cookie = `${MOCK_COOKIE}=${encoded}; path=/; max-age=86400; SameSite=Lax`;
    setUser(mockUser);
    setIsAuthenticated(true);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    deleteCookie(MOCK_COOKIE);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, signInWithGoogle, mockLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
