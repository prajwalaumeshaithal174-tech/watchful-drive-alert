let port: any = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

export function isSerialSupported() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function connectSerial(baud = 9600): Promise<boolean> {
  if (!isSerialSupported()) return false;
  try {
    port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: baud });
    writer = port.writable.getWriter();
    return true;
  } catch (e) {
    console.error("Serial connect failed", e);
    return false;
  }
}

export async function sendBuzz(durationMs = 250) {
  if (!writer) return;
  // Protocol: 'B' = beep on, 'S' = stop. Arduino sketch handles tone duration.
  const enc = new TextEncoder();
  await writer.write(enc.encode("B"));
  setTimeout(async () => {
    try { await writer?.write(enc.encode("S")); } catch {}
  }, durationMs);
}

export async function sendContinuous(on: boolean) {
  if (!writer) return;
  const enc = new TextEncoder();
  await writer.write(enc.encode(on ? "C" : "S"));
}

export async function disconnectSerial() {
  try { await writer?.close(); } catch {}
  try { await port?.close(); } catch {}
  writer = null;
  port = null;
}

export function isSerialConnected() {
  return !!writer;
}