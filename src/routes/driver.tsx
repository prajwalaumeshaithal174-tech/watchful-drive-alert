import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { loadSession, clearSession } from "@/lib/session";
import { beepOnce, speak } from "@/lib/audio";
import { publishStatus, type AlertLevel } from "@/lib/status";

export const Route = createFileRoute("/driver")({
  head: () => ({ meta: [{ title: "Driver Dashboard — Guardian Eye Alert" }] }),
  component: DriverDashboard,
});

function DriverDashboard() {
  const navigate = useNavigate();
  const [account] = useState(loadSession());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stage, setStage] = useState<AlertLevel>("ok");
  const [eyesClosed, setEyesClosed] = useState(false);
  const [drowsyMs, setDrowsyMs] = useState(0);
  const [cameraOk, setCameraOk] = useState(false);
  const [showLanePopup, setShowLanePopup] = useState(false);
  const [yawnPct, setYawnPct] = useState(0);
  const [tiltPct, setTiltPct] = useState(0);

  const drowsyStartRef = useRef<number | null>(null);
  const lastBeepRef = useRef(0);
  const stageRef = useRef<AlertLevel>("ok");
  const sosSpokenRef = useRef(false);
  const eyesOpenStartRef = useRef<number | null>(null);
  const sosLatchedRef = useRef(false);
  const [sosLatched, setSosLatched] = useState(false);

  useEffect(() => {
    if (!account) { navigate({ to: "/" }); return; }
    if (account.role !== "driver") navigate({ to: "/manager" });
  }, [account, navigate]);

  const broadcast = (level: AlertLevel, duration: number) => {
    if (!account) return;
    publishStatus(account.username, account.displayName, level, duration).catch(console.error);
  };

  // Heartbeat: publish "ok" so manager sees driver is online
  useEffect(() => {
    if (!account) return;
    broadcast("ok", 0);
    const id = setInterval(() => {
      if (stageRef.current === "ok") broadcast("ok", 0);
    }, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.username]);

  // Start camera + MediaPipe FaceMesh
  useEffect(() => {
    let stream: MediaStream | null = null;
    let faceMesh: any = null;
    let rafId: number | null = null;
    let cancelled = false;

    async function loadScript(src: string) {
      return new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src; s.crossOrigin = "anonymous";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
      });
    }

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
        }
        setCameraOk(true);

        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
        if (cancelled) return;
        const FM = (window as any).FaceMesh;
        if (!FM) return;

        faceMesh = new FM({
          locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1, refineLandmarks: true,
          minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        const tick = async () => {
          if (cancelled) return;
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try { await faceMesh.send({ image: videoRef.current }); } catch {}
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (e) {
        console.error("Camera init failed", e);
      }
    }

    function ear(landmarks: any[], idx: number[]) {
      const p = idx.map(i => landmarks[i]);
      const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
      const v = (dist(p[1], p[5]) + dist(p[2], p[4])) / 2;
      const h = dist(p[0], p[3]);
      return h === 0 ? 1 : v / h;
    }

    function onResults(results: any) {
      const canvas = canvasRef.current;
      if (!canvas || !videoRef.current) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      const lms = results.multiFaceLandmarks?.[0];
      let closed = false;
      if (lms) {
        const leftIdx = [33, 160, 158, 133, 153, 144];
        const rightIdx = [362, 385, 387, 263, 373, 380];
        const avg = (ear(lms, leftIdx) + ear(lms, rightIdx)) / 2;
        closed = avg < 0.21;

        ctx.strokeStyle = closed ? "#ef4444" : "#22d3ee";
        ctx.lineWidth = 2;
        [leftIdx, rightIdx].forEach(group => {
          ctx.beginPath();
          group.forEach((i, k) => {
            const x = lms[i].x * canvas.width;
            const y = lms[i].y * canvas.height;
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.stroke();
        });

        // Mouth Aspect Ratio (MAR) → yawn %
        // Outer mouth corners: 61 (L), 291 (R); top: 13, bottom: 14
        const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
        const mouthW = dist(lms[61], lms[291]);
        const mouthH = dist(lms[13], lms[14]);
        const mar = mouthW === 0 ? 0 : mouthH / mouthW;
        // 0.05 ≈ closed, 0.6+ ≈ wide yawn
        const yawn = Math.max(0, Math.min(100, Math.round(((mar - 0.05) / 0.55) * 100)));
        setYawnPct(yawn);

        // Head tilt (roll) from eye line angle
        const lEye = lms[33], rEye = lms[263];
        const dy = rEye.y - lEye.y;
        const dx = rEye.x - lEye.x;
        const angleDeg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
        // 0° = level, 45°+ = strongly tilted
        const tilt = Math.max(0, Math.min(100, Math.round((angleDeg / 45) * 100)));
        setTiltPct(tilt);

        // Draw mouth outline
        ctx.strokeStyle = yawn > 60 ? "#f59e0b" : "#22d3ee";
        ctx.beginPath();
        const mouthIdx = [61, 13, 291, 14];
        mouthIdx.forEach((i, k) => {
          const x = lms[i].x * canvas.width;
          const y = lms[i].y * canvas.height;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
      }
      setEyesClosed(closed);
      ctx.restore();
    }

    init();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { faceMesh?.close?.(); } catch {}
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Escalation timer
  useEffect(() => {
    const id = setInterval(() => {
      if (eyesClosed) {
        eyesOpenStartRef.current = null;
        if (drowsyStartRef.current == null) {
          drowsyStartRef.current = Date.now();
          sosSpokenRef.current = false;
        }
        const elapsed = Date.now() - drowsyStartRef.current;
        setDrowsyMs(elapsed);

        let next: AlertLevel = "ok";
        if (elapsed >= 6000) next = "sos";
        else if (elapsed >= 4000) next = "lane";
        else if (elapsed >= 2000) next = "drowsy";

        // Once SOS has latched, keep it at SOS regardless of momentary eye opens
        if (sosLatchedRef.current) next = "sos";
        if (next === "sos") {
          sosLatchedRef.current = true;
          setSosLatched(true);
        }

        if (next !== stageRef.current) {
          stageRef.current = next;
          setStage(next);
          if (next === "drowsy") beepOnce(880, 300);
          if (next === "lane") { setShowLanePopup(true); speak("Change the lane"); }
          if (next === "sos" && !sosSpokenRef.current) {
            sosSpokenRef.current = true;
            speak("SOS emergency! Pull over safely now.");
          }
          broadcast(next, elapsed);
        } else if (next === "drowsy") {
          if (Date.now() - lastBeepRef.current > 700) {
            beepOnce(880, 250);
            lastBeepRef.current = Date.now();
          }
        } else if (next === "sos") {
          if (Date.now() - lastBeepRef.current > 1500) {
            beepOnce(1200, 400);
            lastBeepRef.current = Date.now();
          }
        }
        if (next !== "ok") broadcast(next, elapsed);
      } else {
        // SOS is latched — never auto-clear; require manual acknowledge
        if (sosLatchedRef.current) {
          if (Date.now() - lastBeepRef.current > 1500) {
            beepOnce(1200, 400);
            lastBeepRef.current = Date.now();
          }
          broadcast("sos", Math.max(drowsyMs, 6000));
          return;
        }
        // Require eyes open for 1.5s before clearing drowsy/lane state
        if (eyesOpenStartRef.current == null) eyesOpenStartRef.current = Date.now();
        const openFor = Date.now() - eyesOpenStartRef.current;
        if (openFor < 1500 && stageRef.current !== "ok") {
          // hold current stage briefly to avoid blink-induced flicker
          broadcast(stageRef.current, drowsyMs);
          return;
        }
        if (drowsyStartRef.current != null) {
          drowsyStartRef.current = null;
          setDrowsyMs(0);
          setShowLanePopup(false);
          if (stageRef.current !== "ok") {
            stageRef.current = "ok";
            setStage("ok");
            broadcast("ok", 0);
          }
        }
      }
    }, 150);
    return () => clearInterval(id);
  }, [eyesClosed, drowsyMs]);

  const acknowledgeSos = () => {
    sosLatchedRef.current = false;
    setSosLatched(false);
    sosSpokenRef.current = false;
    drowsyStartRef.current = null;
    eyesOpenStartRef.current = Date.now();
    setDrowsyMs(0);
    setShowLanePopup(false);
    stageRef.current = "ok";
    setStage("ok");
    broadcast("ok", 0);
  };

  const stageBadge = {
    ok:     { text: "ALERT",   cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
    drowsy: { text: "DROWSY",  cls: "bg-amber-500/20  text-amber-300  border-amber-500/40" },
    lane:   { text: "CHANGE LANE", cls: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
    sos:    { text: "SOS EMERGENCY", cls: "bg-red-500/30 text-red-200 border-red-500/60 animate-pulse" },
  }[stage];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold leading-tight truncate">Driver Dashboard</p>
              <p className="text-xs text-slate-400 truncate">{account?.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-bold border ${stageBadge.cls}`}>
              {stageBadge.text}
            </span>
            <button
              onClick={() => { clearSession(); navigate({ to: "/" }); }}
              className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-slate-700 hover:bg-slate-800 transition"
            >Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 sm:p-6 grid lg:grid-cols-3 gap-4 sm:gap-6">
        <section className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-semibold text-sm sm:text-base">Real-time Video Feed</h2>
            <span className={`text-xs px-2 py-0.5 rounded ${cameraOk ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
              {cameraOk ? "Camera live" : "Initializing…"}
            </span>
          </div>
          <div className="relative bg-black aspect-video">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-0" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute top-2 left-2 bg-black/60 rounded px-2 py-1 text-[11px] sm:text-xs">
              Eyes: <span className={eyesClosed ? "text-red-400 font-bold" : "text-emerald-300"}>{eyesClosed ? "CLOSED" : "OPEN"}</span>
              {drowsyMs > 0 && <> · {(drowsyMs / 1000).toFixed(1)}s</>}
            </div>
            <div className="absolute top-2 right-2 bg-black/60 rounded px-2 py-1 text-[11px] sm:text-xs space-y-0.5">
              <div>Yawn: <span className={yawnPct > 60 ? "text-amber-300 font-bold" : "text-slate-200"}>{yawnPct}%</span></div>
              <div>Head tilt: <span className={tiltPct > 50 ? "text-orange-300 font-bold" : "text-slate-200"}>{tiltPct}%</span></div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <h3 className="font-semibold mb-3">Alert Timeline</h3>
            <ul className="space-y-2 text-sm">
              <li className={`flex justify-between ${stage === "drowsy" || stage === "lane" || stage === "sos" ? "text-amber-300" : "text-slate-400"}`}>
                <span>2s — Beep alert</span><span>{drowsyMs >= 2000 ? "✓" : "—"}</span>
              </li>
              <li className={`flex justify-between ${stage === "lane" || stage === "sos" ? "text-orange-300" : "text-slate-400"}`}>
                <span>4s — "Change the lane" popup</span><span>{drowsyMs >= 4000 ? "✓" : "—"}</span>
              </li>
              <li className={`flex justify-between ${stage === "sos" ? "text-red-300 font-bold" : "text-slate-400"}`}>
                <span>6s — SOS Emergency</span><span>{drowsyMs >= 6000 ? "✓" : "—"}</span>
              </li>
            </ul>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <h3 className="font-semibold mb-3">Fatigue Signals</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-300">Yawning</span>
                  <span className={yawnPct > 60 ? "text-amber-300 font-bold" : "text-slate-400"}>{yawnPct}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all" style={{ width: `${yawnPct}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-300">Head Tilt</span>
                  <span className={tiltPct > 50 ? "text-orange-300 font-bold" : "text-slate-400"}>{tiltPct}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all" style={{ width: `${tiltPct}%` }} />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400">
            Status syncs live to your manager across any device. Keep this tab open while driving.
          </div>
        </aside>
      </main>

      {showLanePopup && stage !== "sos" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-orange-500 text-black rounded-2xl p-6 sm:p-8 max-w-md text-center shadow-2xl animate-bounce">
            <p className="text-xs sm:text-sm uppercase tracking-widest font-bold">Drowsiness detected</p>
            <p className="text-3xl sm:text-4xl font-black mt-2">CHANGE THE LANE</p>
            <p className="mt-3 text-sm">Pull into the slow lane and prepare to stop safely.</p>
          </div>
        </div>
      )}

      {stage === "sos" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/90 p-4">
          <div className="text-center">
            <p className="text-red-300 uppercase tracking-[0.3em] text-xs sm:text-sm">Emergency</p>
            <p className="text-6xl sm:text-7xl font-black text-white mt-2 animate-pulse">SOS</p>
            <p className="text-red-200 mt-4 max-w-md mx-auto text-sm sm:text-base">
              Driver is unresponsive. Manager has been notified. Pull over immediately.
            </p>
            {sosLatched && (
              <button
                onClick={acknowledgeSos}
                className="mt-6 px-5 py-2.5 rounded-lg bg-white text-red-700 font-bold hover:bg-red-100"
              >I'm safe — clear SOS</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}