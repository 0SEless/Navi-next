const MOCK_COOKIE = "navi-mock-session";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "campus_admin" | "mapping_staff" | "viewer";
  campus_id: string | null;
}

export const MOCK_USERS: MockUser[] = [
  { id: "mock-super-admin", name: "Dr. Admin", email: "admin@asu.edu", role: "super_admin", campus_id: null },
  { id: "mock-campus-admin", name: "Campus Admin", email: "campus@asu.edu", role: "campus_admin", campus_id: "campus-ibajay" },
  { id: "mock-mapper", name: "Mapper Staff", email: "mapper@asu.edu", role: "mapping_staff", campus_id: "campus-ibajay" },
  { id: "mock-viewer", name: "Viewer User", email: "viewer@asu.edu", role: "viewer", campus_id: "campus-ibajay" },
];

export function encodeMockSession(user: MockUser): string {
  return btoa(JSON.stringify(user));
}

export function decodeMockSession(raw: string): MockUser | null {
  try {
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}

export function isMockAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NEXT_PUBLIC_MOCK_AUTH === "true";
}

export { MOCK_COOKIE };
