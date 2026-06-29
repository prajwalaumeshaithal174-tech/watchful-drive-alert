import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { loadSession, clearSession } from "@/lib/session";
import {
  fetchAllStatus,
  subscribeStatus,
  type AlertLevel,
  type DriverStatusRow,
} from "@/lib/status";
import { startContinuousAlarm, stopContinuousAlarm, speak, beepOnce } from "@/lib/audio";

export const Route = createFileRoute("/manager")({
  head: () => ({ meta: [{ title: "Manager Control Panel — Guardian Eye Alert" }] }),
  component: ManagerPanel,
});

function ManagerPanel() {
  const navigate = useNavigate();
  const [account] = useState(loadSession());
  const [drivers, setDrivers] = useState<Record<string, DriverStatusRow>>({});
  const [audioArmed, setAudioArmed] = useState(false);
  const alarmOnRef = useRef(false);
  const lastSpokenRef = useRef<Record<string, AlertLevel>>({});
  const lastBeepRef = useRef(0);

  useEffect(() => {
    if (!account) { navigate({ to: "/" }); return; }
    if (account.role !== "manager") navigate({ to: "/driver" });
  }, [account, navigate]);

  useEffect(() => {
    let mounted = true;
    fetchAllStatus().then(rows => {
      if (!mounted) return;
      const map: Record<string, DriverStatusRow> = {};
      rows.forEach(r => { map[r.driver_id] = r; });
      setDrivers(map);
    });
    const unsub = subscribeStatus(row => {
      setDrivers(prev => ({ ...prev, [row.driver_id]: row }));
    });
    return () => { mounted = false; unsub(); };
  }, []);

  useEffect(() => {
    const liveDrivers = Object.values(drivers).filter(
      d => Date.now() - new Date(d.updated_at).getTime() <= 20000,
    );
    const anyAlert = liveDrivers.some(
      d =>
        d.level !== "ok" &&
        d.duration_ms >= 2000,
    );
    if (anyAlert && audioArmed && !alarmOnRef.current) {
      startContinuousAlarm(1000);
      alarmOnRef.current = true;
    }
    if (!anyAlert && alarmOnRef.current) {
      stopContinuousAlarm();
      alarmOnRef.current = false;
    }

    if (audioArmed) {
      for (const d of liveDrivers) {
        const prev = lastSpokenRef.current[d.driver_id];
        if (prev !== d.level) {
          lastSpokenRef.current[d.driver_id] = d.level;
          if (d.level === "drowsy") { beepOnce(880, 300); speak(`Drowsiness alert for ${d.driver_name}`); }
          else if (d.level === "lane") { beepOnce(1000, 350); speak(`${d.driver_name}, change the lane`); }
          else if (d.level === "sos") { beepOnce(1200, 500); speak(`SOS emergency from ${d.driver_name}. Pull over now.`); }
        }
      }
    }
  }, [drivers, audioArmed]);

  useEffect(() => () => { stopContinuousAlarm(); }, []);

  const list = Object.values(drivers).sort((a, b) => a.driver_id.localeCompare(b.driver_id));
  const liveList = list.filter(d => Date.now() - new Date(d.updated_at).getTime() <= 20000);
  const activeAlerts = liveList.filter(d => d.level !== "ok").length;
  const sosDriver = liveList.find(d => d.level === "sos");
  const laneDriver = !sosDriver ? liveList.find(d => d.level === "lane") : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-12V5l-8-3-8 3v5c0 8 8 12 8 12z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold leading-tight truncate">Manager Control Panel</p>
              <p className="text-xs text-slate-400 truncate">{account?.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold border ${activeAlerts > 0 ? "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"}`}>
              {activeAlerts > 0 ? `${activeAlerts} ALERT${activeAlerts > 1 ? "S" : ""}` : "ALL CLEAR"}
            </span>
            <button
              onClick={() => { clearSession(); navigate({ to: "/" }); }}
              className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-slate-700 hover:bg-slate-800 transition"
            >Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {!audioArmed && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-200">Enable alert audio</p>
              <p className="text-sm text-amber-200/70">Tap to allow continuous alarm sound on this device.</p>
            </div>
            <button
              onClick={() => setAudioArmed(true)}
              className="px-4 py-2 rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 self-start sm:self-auto"
            >Arm Audio</button>
          </div>
        )}

        <section>
          <h2 className="text-base sm:text-lg font-semibold mb-3">Live Driver Status</h2>
          {list.length === 0 ? (
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-8 sm:p-12 text-center text-slate-400">
              Waiting for drivers to come online…
              <p className="text-xs mt-2">Drivers will appear here automatically the moment they sign in from any device.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {list.map(d => <DriverCard key={d.driver_id} d={d} />)}
            </div>
          )}
        </section>

        <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <h3 className="font-semibold mb-2">How alerts work</h3>
          <ul className="text-sm text-slate-300 space-y-1 list-disc pl-5">
            <li><b>2s</b> drowsy → driver beep, manager continuous alarm starts</li>
            <li><b>4s</b> → "Change the lane" popup on driver's screen</li>
            <li><b>6s</b> → SOS emergency on driver & manager</li>
          </ul>
        </section>
      </main>

      {laneDriver && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-orange-500 text-black rounded-2xl p-6 sm:p-8 max-w-md text-center shadow-2xl animate-bounce">
            <p className="text-xs sm:text-sm uppercase tracking-widest font-bold">Drowsiness detected</p>
            <p className="text-3xl sm:text-4xl font-black mt-2">CHANGE THE LANE</p>
            <p className="mt-3 text-sm">{laneDriver.driver_name} — instruct driver to pull into the slow lane.</p>
          </div>
        </div>
      )}

      {sosDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/90 p-4">
          <div className="text-center">
            <p className="text-red-300 uppercase tracking-[0.3em] text-xs sm:text-sm">Emergency</p>
            <p className="text-6xl sm:text-7xl font-black text-white mt-2 animate-pulse">SOS</p>
            <p className="text-red-200 mt-4 max-w-md mx-auto text-sm sm:text-base">
              {sosDriver.driver_name} is unresponsive. Contact driver immediately.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DriverCard({ d }: { d: DriverStatusRow }) {
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
  const stale = Date.now() - new Date(d.updated_at).getTime() > 20000;
  return (
    <div className={`bg-gradient-to-br ${colors[d.level]} border rounded-2xl p-4 sm:p-5`}>
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0">
          <p className="font-bold truncate">{d.driver_name}</p>
          <p className="text-xs text-slate-300/70 truncate">@{d.driver_id}</p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${stale ? "bg-slate-700 text-slate-300" : "bg-emerald-500/20 text-emerald-300"}`}>
          {stale ? "offline" : "live"}
        </span>
      </div>
      <p className="text-lg sm:text-xl font-bold">{labels[d.level]}</p>
      {d.duration_ms > 0 && d.level !== "ok" && (
        <p className="text-sm mt-1 opacity-80">Eyes closed for {(d.duration_ms / 1000).toFixed(1)}s</p>
      )}
    </div>
  );
}