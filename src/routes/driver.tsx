import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { loadSession, clearSession } from "@/lib/session";
import { getChannel, type DriverStatus } from "@/lib/broadcast";
import { beepOnce, speak } from "@/lib/audio";
import { connectSerial, isSerialConnected, sendBuzz, isSerialSupported } from "@/lib/serial";

export const Route = createFileRoute("/driver")({
  head: () => ({ meta: [{ title: "Driver Dashboard — Guardian Eye Alert" }] }),
  component: DriverDashboard,
});

type Stage = "ok" | "drowsy" | "lane" | "sos";

function DriverDashboard() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(loadSession());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const [stage, setStage] = useState<Stage>("ok");
  const [eyesClosed, setEyesClosed] = useState(false);
  const [drowsyMs, setDrowsyMs] = useState(0);
  const [serialOk, setSerialOk] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  const [showLanePopup, setShowLanePopup] = useState(false);

  const drowsyStartRef = useRef<number | null>(null);
  const lastBeepRef = useRef(0);
  const stageRef = useRef<Stage>("ok");
  const sosSpokenRef = useRef(false);

  useEffect(() => {
    if (!account) {
      navigate({ to: "/" });
      return;
    }
    if (account.role !== "driver") {
      navigate({ to: "/manager" });
    }
  }, [account, navigate]);

  // BroadcastChannel
  useEffect(() => {
    const ch = getChannel();
    channelRef.current = ch;
    return () => { ch?.close(); };
  }, []);

  const broadcast = (level: Stage, duration: number) => {
    if (!account || !channelRef.current) return;
    const msg: DriverStatus = {
      type: "status",
      driverId: account.username,
      driverName: account.displayName,
      level,
      duration,
      ts: Date.now(),
    };
    channelRef.current.postMessage(msg);
  };

  // Start camera + load MediaPipe FaceMesh
  useEffect(() => {
    let stream: MediaStream | null = null;
    let faceMesh: any = null;
    let camera: any = null;
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraOk(true);

        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
        if (cancelled) return;

        const FM = (window as any).FaceMesh;
        const Cam = (window as any).Camera;
        if (!FM) return;

        faceMesh = new FM({
          locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(onResults);

        if (videoRef.current && Cam) {
          camera = new Cam(videoRef.current, {
            onFrame: async () => { if (videoRef.current) await faceMesh.send({ image: videoRef.current }); },
            width: 640, height: 480,
          });
          camera.start();
        }
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
        // Approximate EAR indices for MediaPipe FaceMesh
        const leftIdx = [33, 160, 158, 133, 153, 144];
        const rightIdx = [362, 385, 387, 263, 373, 380];
        const earL = ear(lms, leftIdx);
        const earR = ear(lms, rightIdx);
        const avg = (earL + earR) / 2;
        closed = avg < 0.21;

        // draw eye boxes
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
      }
      setEyesClosed(closed);
      ctx.restore();
    }

    init();
    return () => {
      cancelled = true;
      try { camera?.stop?.(); } catch {}
      try { faceMesh?.close?.(); } catch {}
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Drowsy timer loop — escalates stages based on duration eyes have been closed
  useEffect(() => {
    const id = setInterval(() => {
      if (eyesClosed) {
        if (drowsyStartRef.current == null) {
          drowsyStartRef.current = Date.now();
          sosSpokenRef.current = false;
        }
        const elapsed = Date.now() - drowsyStartRef.current;
        setDrowsyMs(elapsed);

        let next: Stage = "ok";
        if (elapsed >= 6000) next = "sos";
        else if (elapsed >= 4000) next = "lane";
        else if (elapsed >= 2000) next = "drowsy";

        if (next !== stageRef.current) {
          stageRef.current = next;
          setStage(next);

          if (next === "drowsy") {
            // 2s: single beep on driver buzzer
            beepOnce(880, 300);
            if (isSerialConnected()) sendBuzz(300);
          }
          if (next === "lane") {
            // 4s: popup on driver screen
            setShowLanePopup(true);
            speak("Change the lane");
          }
          if (next === "sos" && !sosSpokenRef.current) {
            sosSpokenRef.current = true;
            speak("SOS emergency! Pull over safely now.");
          }
          broadcast(next, elapsed);
        } else if (next === "drowsy") {
          // keep repeating beep every ~700ms while drowsy
          if (Date.now() - lastBeepRef.current > 700) {
            beepOnce(880, 250);
            if (isSerialConnected()) sendBuzz(250);
            lastBeepRef.current = Date.now();
          }
        } else if (next === "sos") {
          // periodic re-announce
          if (Date.now() - lastBeepRef.current > 1500) {
            beepOnce(1200, 400);
            if (isSerialConnected()) sendBuzz(400);
            lastBeepRef.current = Date.now();
          }
        }
        // broadcast duration updates while in an alert stage
        if (next !== "ok") broadcast(next, elapsed);
      } else {
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
  }, [eyesClosed]);

  const stageBadge = {
    ok:     { text: "ALERT",   cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
    drowsy: { text: "DROWSY",  cls: "bg-amber-500/20  text-amber-300  border-amber-500/40" },
    lane:   { text: "CHANGE LANE", cls: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
    sos:    { text: "SOS EMERGENCY", cls: "bg-red-500/30 text-red-200 border-red-500/60 animate-pulse" },
  }[stage];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <p className="font-semibold leading-tight">Driver Dashboard</p>
              <p className="text-xs text-slate-400">{account?.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${stageBadge.cls}`}>
              {stageBadge.text}
            </span>
            <button
              onClick={() => { clearSession(); navigate({ to: "/" }); }}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800 transition"
            >Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid lg:grid-cols-3 gap-6">
        {/* Video feed */}
        <section className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-semibold">Real-time Video Feed</h2>
            <span className={`text-xs px-2 py-0.5 rounded ${cameraOk ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
              {cameraOk ? "Camera live" : "Initializing…"}
            </span>
          </div>
          <div className="relative bg-black aspect-video">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-0" playsInline muted />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
            {/* Overlay state */}
            <div className="absolute top-3 left-3 bg-black/60 rounded px-2 py-1 text-xs">
              Eyes: <span className={eyesClosed ? "text-red-400 font-bold" : "text-emerald-300"}>{eyesClosed ? "CLOSED" : "OPEN"}</span>
              {drowsyMs > 0 && <> · {(drowsyMs / 1000).toFixed(1)}s</>}
            </div>
          </div>
        </section>

        {/* Side panel */}
        <aside className="space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <h3 className="font-semibold mb-3">Arduino Buzzer (Web Serial)</h3>
            <p className="text-xs text-slate-400 mb-3">
              {isSerialSupported() ? "Connect your Arduino over USB. Sketch should beep on 'B', continuous on 'C', stop on 'S'." : "Web Serial not supported in this browser. Use Chrome/Edge."}
            </p>
            <button
              disabled={!isSerialSupported() || serialOk}
              onClick={async () => setSerialOk(await connectSerial())}
              className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-semibold"
            >
              {serialOk ? "Connected ✓" : "Connect Arduino"}
            </button>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <h3 className="font-semibold mb-3">Alert Timeline</h3>
            <ul className="space-y-2 text-sm">
              <li className={`flex justify-between ${stage === "drowsy" || stage === "lane" || stage === "sos" ? "text-amber-300" : "text-slate-400"}`}>
                <span>2s — Buzzer beep</span><span>{drowsyMs >= 2000 ? "✓" : "—"}</span>
              </li>
              <li className={`flex justify-between ${stage === "lane" || stage === "sos" ? "text-orange-300" : "text-slate-400"}`}>
                <span>4s — "Change the lane" popup</span><span>{drowsyMs >= 4000 ? "✓" : "—"}</span>
              </li>
              <li className={`flex justify-between ${stage === "sos" ? "text-red-300 font-bold" : "text-slate-400"}`}>
                <span>6s — SOS Emergency</span><span>{drowsyMs >= 6000 ? "✓" : "—"}</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      {/* Change-lane popup (4s) */}
      {showLanePopup && stage !== "sos" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-orange-500 text-black rounded-2xl p-8 max-w-md text-center shadow-2xl animate-bounce">
            <p className="text-sm uppercase tracking-widest font-bold">Drowsiness detected</p>
            <p className="text-4xl font-black mt-2">CHANGE THE LANE</p>
            <p className="mt-3 text-sm">Pull into the slow lane and prepare to stop safely.</p>
          </div>
        </div>
      )}

      {/* SOS overlay (6s) */}
      {stage === "sos" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/90">
          <div className="text-center">
            <p className="text-red-300 uppercase tracking-[0.3em] text-sm">Emergency</p>
            <p className="text-7xl font-black text-white mt-2 animate-pulse">SOS</p>
            <p className="text-red-200 mt-4 max-w-md mx-auto">
              Driver is unresponsive. Manager has been notified. Pull over immediately.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}