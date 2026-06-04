import type { Account } from "./credentials";

const KEY = "guardian_session";

export function saveSession(acc: Account) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(acc));
}

export function loadSession(): Account | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}