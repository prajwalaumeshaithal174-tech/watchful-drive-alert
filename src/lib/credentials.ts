// Client-safe types only. Passwords and the account list live in credentials.server.ts.
export type Role = "driver" | "manager";

export interface SessionUser {
  username: string;
  role: Role;
  displayName: string;
}