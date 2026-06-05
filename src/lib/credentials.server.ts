import type { Role } from "./credentials";

interface ServerAccount {
  username: string;
  password: string;
  role: Role;
  displayName: string;
}

// Server-only credential list. Never imported into client code.
export const ACCOUNTS: ServerAccount[] = [
  { username: "manager",  password: "Guardian@2026", role: "manager", displayName: "Fleet Manager" },
  { username: "driver1",  password: "Drive@1234",    role: "driver",  displayName: "Driver 1 — Arjun" },
  { username: "driver2",  password: "Drive@5678",    role: "driver",  displayName: "Driver 2 — Priya" },
  { username: "driver3",  password: "Drive@9012",    role: "driver",  displayName: "Driver 3 — Rahul" },
];

export function verifyCredentials(username: string, password: string): ServerAccount | null {
  const u = username.trim().toLowerCase();
  return ACCOUNTS.find(a => a.username.toLowerCase() === u && a.password === password) ?? null;
}