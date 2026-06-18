import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const StatusInput = z.object({
  driverId: z.string().min(1).max(64),
  driverName: z.string().min(1).max(120),
  level: z.enum(["ok", "drowsy", "lane", "sos"]),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
});

export const publishStatusFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => StatusInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("driver_status").upsert(
      {
        driver_id: data.driverId,
        driver_name: data.driverName,
        level: data.level,
        duration_ms: data.durationMs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "driver_id" },
    );
    if (error) throw new Error("Failed to publish status");
    return { ok: true };
  });