import { supabase } from "@/integrations/supabase/client";
import { publishStatusFn } from "./status.functions";

export type AlertLevel = "ok" | "drowsy" | "lane" | "sos";

export interface DriverStatusRow {
  driver_id: string;
  driver_name: string;
  level: AlertLevel;
  duration_ms: number;
  updated_at: string;
}

export async function publishStatus(
  driverId: string,
  driverName: string,
  level: AlertLevel,
  durationMs: number,
) {
  await publishStatusFn({
    data: {
      driverId,
      driverName,
      level,
      durationMs: Math.round(durationMs),
    },
  });
}

export async function fetchAllStatus(): Promise<DriverStatusRow[]> {
  const { data } = await supabase.from("driver_status").select("*");
  return (data as DriverStatusRow[]) ?? [];
}

export function subscribeStatus(
  cb: (row: DriverStatusRow) => void,
): () => void {
  const ch = supabase
    .channel("driver_status_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "driver_status" },
      (payload) => {
        const row = (payload.new ?? payload.old) as DriverStatusRow;
        if (row?.driver_id) cb(row);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}