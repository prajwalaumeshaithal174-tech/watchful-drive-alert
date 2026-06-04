export type Role = "driver" | "manager";

export interface Account {
  username: string;
  password: string;
  role: Role;
  displayName: string;
}

export const ACCOUNTS: Account[] = [
  { username: "manager",  password: "Guardian@2026", role: "manager", displayName: "Fleet Manager" },
  { username: "driver1",  password: "Drive@1234",    role: "driver",  displayName: "Driver 1 — Arjun" },
  { username: "driver2",  password: "Drive@5678",    role: "driver",  displayName: "Driver 2 — Priya" },
  { username: "driver3",  password: "Drive@9012",    role: "driver",  displayName: "Driver 3 — Rahul" },
];

export function authenticate(username: string, password: string): Account | null {
  const u = username.trim().toLowerCase();
  const acc = ACCOUNTS.find(a => a.username.toLowerCase() === u && a.password === password);
  return acc ?? null;
}