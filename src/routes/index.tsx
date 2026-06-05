import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { loginFn } from "@/lib/auth.functions";
import { saveSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Guardian Eye Alert — Login" },
      { name: "description", content: "Unified login for drivers and fleet managers." },
      { property: "og:title", content: "Guardian Eye Alert" },
      { property: "og:description", content: "Real-time drowsiness detection & fleet alerts." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const login = useServerFn(loginFn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await login({ data: { username, password } });
      if (!res.ok) {
        setError("Invalid credentials. Check the credentials PDF.");
        return;
      }
      saveSession(res.user);
      navigate({ to: res.user.role === "manager" ? "/manager" : "/driver" });
    } catch {
      setError("Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 mb-4 shadow-lg shadow-cyan-500/30">
            <svg viewBox="0 0 24 24" className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Guardian Eye Alert</h1>
          <p className="text-slate-400 text-sm mt-2">Drowsiness detection & fleet safety</p>
        </div>

        <form onSubmit={onSubmit} className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold mb-4">Unified Login</h2>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full mb-4 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
            placeholder="driver1 or manager"
          />
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full mb-4 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
            placeholder="••••••••"
          />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold hover:opacity-90 transition"
          >
            Sign In
          </button>
          <p className="text-xs text-slate-500 mt-4 text-center">
            Credentials are distributed in the <span className="text-slate-300">Guardian-Credentials.pdf</span> file.
          </p>
        </form>
      </div>
    </div>
  );
}
