import type { SessionUser } from "./credentials";

const KEY = "guardian_session";

export function saveSession(user: SessionUser) {
  if (typeof window === "undefined") return;
  // Only non-sensitive identity data — never the password.
  const safe: SessionUser = {
    username: user.username,
    role: user.role,
    displayName: user.displayName,
  };
  localStorage.setItem(KEY, JSON.stringify(safe));
}

export function loadSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}