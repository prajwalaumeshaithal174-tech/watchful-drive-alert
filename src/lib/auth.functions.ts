import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SessionUser } from "./credentials";

const LoginInput = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((input) => LoginInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; user: SessionUser } | { ok: false }> => {
    const { verifyCredentials } = await import("./credentials.server");
    const acc = verifyCredentials(data.username, data.password);
    if (!acc) return { ok: false };
    return {
      ok: true,
      user: { username: acc.username, role: acc.role, displayName: acc.displayName },
    };
  });