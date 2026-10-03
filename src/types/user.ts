export interface User {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'campus_admin' | 'mapping_staff' | 'viewer';
  campus_id: string | null;
}

import type { MockUser } from "@/lib/mock-auth";

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  mockLogin?: (user: MockUser) => Promise<void>;
  logout: () => Promise<void>;
}
