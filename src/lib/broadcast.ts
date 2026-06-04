export type AlertLevel = "ok" | "drowsy" | "lane" | "sos";

export interface DriverStatus {
  type: "status";
  driverId: string;
  driverName: string;
  level: AlertLevel;
  /** ms since drowsy started; 0 when ok */
  duration: number;
  ts: number;
}

export interface ManagerCommand {
  type: "command";
  targetDriverId: string;
  action: "ack" | "clear";
  ts: number;
}

export type ChannelMsg = DriverStatus | ManagerCommand;

const NAME = "guardian-eye-alert";

export function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  return new BroadcastChannel(NAME);
}