import { createContext, useContext } from "react";
import type { AuthState } from "@/types/user";

export const AuthContext = createContext<AuthState>({
  user: null,
  isAuthenticated: false,
  signInWithGoogle: async () => {},
  mockLogin: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
