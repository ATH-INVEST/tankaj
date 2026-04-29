"use client";

import { useEffect, useState } from "react";

type Run = {
  id: string;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_found: number | null;
  records_updated: number | null;
  error_message: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("sl-SI");
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function loadStatus() {
    const res = await fetch("/api/admin/status", { cache: "no-store" });
    const json = await res.json();

    if (res.ok && json.success) {
      setRuns(json.runs || []);
      setLoggedIn(true);
    } else {
      setLoggedIn(false);
    }
  }

  async function login() {
    setMessage("");

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage("Napačno geslo.");
      return;
    }

    setLoggedIn(true);
    setPassword("");
    await loadStatus();
  }

  async function triggerIngest() {
    setLoading(true);
    setRunning(true);
    setMessage("Poganjam ingest ...");

    try {
      const res = await fetch("/api/admin/ingest", {
        method: "POST",
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setMessage("Ingest ni uspel. Preveri loge.");
      } else {
        setMessage("Ingest uspešno zaključen.");
      }

      await loadStatus();
    } catch {
      setMessage("Napaka pri zagonu ingest procesa.");
    } finally {
      setLoading(false);
      setRunning(false);
    }
  }

  useEffect(() => {
    loadStatus();

    const interval = setInterval(() => {
      loadStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-dvh bg-[#06140f] px-4 py-6 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[32px] border border-white/10 bg-white/[0.055] p-6 shadow-[0_25px_80px_rgba(0,0,0,.25)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-3xl font-black italic tracking-tight">
                Tankaj<span className="text-[#b9fb6a]">.si</span>
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight">
                Admin ingest
              </h1>
              <p className="mt-2 text-white/55">
                Ročni zagon podatkov in pregled zadnjih posodobitev.
              </p>
            </div>

            {loggedIn && (
              <button
                onClick={triggerIngest}
                disabled={loading || running}
                className="rounded-2xl bg-[#b9fb6a] px-6 py-4 text-sm font-black text-[#071a12] disabled:opacity-60"
              >
                {loading || running ? "Poganjam ..." : "Zaženi ingest"}
              </button>
            )}
          </div>

          {!loggedIn && (
            <div className="mt-8 max-w-md rounded-[26px] border border-white/10 bg-[#123024]/72 p-5">
              <label className="text-xs font-bold text-white/50">Geslo</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") login();
                }}
                className="mt-2 h-14 w-full rounded-2xl border border-white/10 bg-[#071a12] px-4 font-semibold outline-none focus:border-[#b9fb6a]/70"
              />
              <button
                onClick={login}
                className="mt-4 h-14 w-full rounded-2xl bg-[#b9fb6a] font-black text-[#071a12]"
              >
                Vstopi
              </button>
            </div>
          )}

          {loggedIn &&
            runs.length > 0 &&
            (() => {
              const latestStartedAt = runs[0].started_at;
              const latestBatch = runs.filter(
                (run) => run.started_at === latestStartedAt,
              );
              const allSuccess = latestBatch.every(
                (run) => run.status === "success",
              );

              return (
                <div className="mt-6 rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-4">
                  <div className="text-xs font-black uppercase tracking-[.2em] text-[#b9fb6a]">
                    Zadnja posodobitev
                  </div>

                  <div className="mt-1 text-lg font-black text-white">
                    {formatDate(
                      latestBatch
                        .map((run) => run.finished_at || run.started_at)
                        .sort()
                        .at(-1),
                    )}
                  </div>

                  <div className="mt-2 text-sm text-white/60">
                    Status:{" "}
                    <span
                      className={
                        allSuccess
                          ? "font-black text-[#b9fb6a]"
                          : "font-black text-red-300"
                      }
                    >
                      {allSuccess ? "vse uspešno" : "delna napaka"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {latestBatch.map((run) => (
                      <span
                        key={run.id}
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          run.status === "success"
                            ? "bg-[#b9fb6a]/12 text-[#b9fb6a]"
                            : "bg-red-500/15 text-red-300"
                        }`}
                      >
                        {run.source}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

          {message && (
            <div className="mt-5 rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-4 text-sm text-[#d9ff9b]">
              {message}
            </div>
          )}

          {loggedIn && (
            <div className="mt-8 overflow-hidden rounded-[26px] border border-white/10">
              <div className="grid grid-cols-6 bg-white/[0.07] px-4 py-3 text-xs font-black uppercase tracking-[.14em] text-white/45">
                <div>Vir</div>
                <div>Status</div>
                <div>Začetek</div>
                <div>Konec</div>
                <div>Najdeno</div>
                <div>Posodobljeno</div>
              </div>

              {runs.map((run) => (
                <div
                  key={run.id}
                  className="grid grid-cols-6 gap-2 border-t border-white/10 px-4 py-4 text-sm"
                >
                  <div className="font-black text-white">{run.source}</div>
                  <div
                    className={
                      run.status === "success"
                        ? "inline-flex rounded-lg bg-[#b9fb6a]/10 px-2 py-1 font-black text-[#b9fb6a]"
                        : run.status === "failed"
                          ? "inline-flex rounded-lg bg-red-500/15 px-2 py-1 font-black text-red-300"
                          : "inline-flex rounded-lg bg-white/10 px-2 py-1 font-black text-white/60"
                    }
                  >
                    {run.status}
                  </div>
                  <div className="text-white/50">
                    {formatDate(run.started_at)}
                  </div>
                  <div className="text-white/50">
                    {formatDate(run.finished_at)}
                  </div>
                  <div className="text-white/70">
                    {run.records_found ?? "—"}
                  </div>
                  <div className="text-white/70">
                    {run.records_updated ?? "—"}
                  </div>

                  {run.error_message && (
                    <div className="col-span-6 rounded-xl bg-red-500/10 p-3 text-xs text-red-200">
                      {run.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
