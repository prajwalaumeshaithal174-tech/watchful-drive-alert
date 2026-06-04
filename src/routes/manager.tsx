import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { loadSession, clearSession } from "@/lib/session";
import { getChannel, type ChannelMsg, type DriverStatus, type AlertLevel } from "@/lib/broadcast";
import { startContinuousAlarm, stopContinuousAlarm, speak } from "@/lib/audio";

export const Route = createFileRoute("/manager")({
  head: () => ({ meta: [{ title: "Manager Control Panel — Guardian Eye Alert" }] }),
  component: ManagerPanel,
});

interface DriverState extends DriverStatus {}

function ManagerPanel() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(loadSession());
  const [drivers, setDrivers] = useState<Record<string, DriverState>>({});
  const [audioArmed, setAudioArmed] = useState(false);
  const alarmOnRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastSpokenRef = useRef<Record<string, AlertLevel>>({});

  useEffect(() => {
    if (!account) { navigate({ to: "/" }); return; }
    if (account.role !== "manager") navigate({ to: "/driver" });
  }, [account, navigate]);

  useEffect(() => {
    const ch = getChannel();
    channelRef.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<ChannelMsg>) => {
      const msg = e.data;
      if (msg.type !== "status") return;
      setDrivers(prev => ({ ...prev, [msg.driverId]: msg }));
    };
    return () => { ch.close(); };
  }, []);

  // Whenever any driver is in alert state >= 2s, start continuous alarm
  useEffect(() => {
    const anyAlert = Object.values(drivers).some(d => d.level !== "ok" && d.duration >= 2000);
    if (anyAlert && audioArmed && !alarmOnRef.current) {
      startContinuousAlarm(1000);
      alarmOnRef.current = true;
    }
    if (!anyAlert && alarmOnRef.current) {
      stopContinuousAlarm();
      alarmOnRef.current = false;
    }

    // Speak escalations once per driver per level
    if (audioArmed) {
      for (const d of Object.values(drivers)) {
        const prev = lastSpokenRef.current[d.driverId];
        if (prev !== d.level) {
          lastSpokenRef.current[d.driverId] = d.level;
          if (d.level === "sos") speak(`SOS emergency from ${d.driverName}`);
          else if (d.level === "lane") speak(`${d.driverName}, change lane warning`);
          else if (d.level === "drowsy") speak(`Drowsiness alert for ${d.driverName}`);
        }
      }
    }
  }, [drivers, audioArmed]);

  useEffect(() => () => { stopContinuousAlarm(); }, []);

  const list = Object.values(drivers).sort((a, b) => a.driverId.localeCompare(b.driverId));
  const activeAlerts = list.filter(d => d.level !== "ok").length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-12V5l-8-3-8 3v5c0 8 8 12 8 12z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold leading-tight">Manager Control Panel</p>
              <p className="text-xs text-slate-400">{account?.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${activeAlerts > 0 ? "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"}`}>
              {activeAlerts > 0 ? `${activeAlerts} ACTIVE ALERT${activeAlerts > 1 ? "S" : ""}` : "ALL CLEAR"}
            </span>
            <button
              onClick={() => { clearSession(); navigate({ to: "/" }); }}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 transition"
            >Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {!audioArmed && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-amber-200">Enable alert audio</p>
              <p className="text-sm text-amber-200/70">Browsers block sound until you interact. Click to arm the continuous alarm.</p>
            </div>
            <button
              onClick={() => setAudioArmed(true)}
              className="px-4 py-2 rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400"
            >Arm Audio</button>
          </div>
        )}

        <section>
          <h2 className="text-lg font-semibold mb-3">Live Driver Status</h2>
          {list.length === 0 ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
              Waiting for driver dashboards to connect…
              <p className="text-xs mt-2">Open the app in another tab and log in as <code className="text-cyan-300">driver1</code>.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {list.map(d => <DriverCard key={d.driverId} d={d} />)}
            </div>
          )}
        </section>

        <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
          <h3 className="font-semibold mb-2">How alerts work</h3>
          <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
            <li><b>2s</b> drowsy → driver buzzer beeps once, manager alarm starts (continuous)</li>
            <li><b>4s</b> → "Change the lane" popup on driver's screen only</li>
            <li><b>6s</b> → SOS Emergency voice announcement to driver & manager</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function DriverCard({ d }: { d: DriverStatus }) {
  const colors: Record<AlertLevel, string> = {
    ok: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/40",
    drowsy: "from-amber-500/30 to-amber-500/5 border-amber-500/50",
    lane: "from-orange-500/30 to-orange-500/5 border-orange-500/50",
    sos: "from-red-600/40 to-red-600/10 border-red-500 animate-pulse",
  };
  const labels: Record<AlertLevel, string> = {
    ok: "Alert & Focused",
    drowsy: "Drowsiness detected",
    lane: "Change lane warning",
    sos: "SOS — EMERGENCY",
  };
  const stale = Date.now() - d.ts > 5000;
  return (
    <div className={`bg-gradient-to-br ${colors[d.level]} border rounded-2xl p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-bold">{d.driverName}</p>
          <p className="text-xs text-slate-300/70">@{d.driverId}</p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${stale ? "bg-slate-700 text-slate-300" : "bg-emerald-500/20 text-emerald-300"}`}>
          {stale ? "stale" : "live"}
        </span>
      </div>
      <p className="text-xl font-bold">{labels[d.level]}</p>
      {d.duration > 0 && (
        <p className="text-sm mt-1 opacity-80">Eyes closed for {(d.duration / 1000).toFixed(1)}s</p>
      )}
    </div>
  );
}