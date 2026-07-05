"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Clock, Database, RefreshCw } from "lucide-react";
import { Logo } from "@/components/Logo";

interface SyncState {
  lastSyncedAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  totalPosts: number;
  tokenRequired?: boolean;
  autoFetchTimes?: number[];
  throttleSeconds?: number;
}

type FetchStatus = "success" | "incomplete" | "failed";

/** Short badge label + colour class for the three fetch outcomes. */
function statusBadge(status: string | null): { label: string; cls: string } {
  if (status === "success") return { label: "Berhasil", cls: "text-emerald-300" };
  if (status === "incomplete") return { label: "Data lama", cls: "text-amber-300" };
  if (status === "failed") return { label: "Gagal", cls: "text-red-300" };
  return { label: "—", cls: "" };
}

/** Turn a raw `last_status` value into a short, human-readable reason. */
function describeStatus(status: string | null): string {
  if (!status || status === "success") return "";
  if (status === "incomplete")
    return "Fetch berhasil tetapi data kurang lengkap — memakai data lama.";
  if (status === "failed") return "Fetch gagal total — memakai data lama.";
  return status.replace(/^error:\s*/, "");
}

interface SyncResponse {
  ok: boolean;
  count: number;
  syncedAt: string;
  fetchStatus?: FetchStatus;
  throttled?: boolean;
  retryAfter?: number;
  error?: string;
  state?: SyncState | null;
}

const dtFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Makassar",
});

function formatWhen(iso: string | null): string {
  if (!iso) return "Belum pernah";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${dtFormatter.format(d)} WITA`;
}

function formatSchedule(times: number[] | undefined): string {
  if (!times || times.length === 0) return "Nonaktif";
  return times.map((h) => `${String(h).padStart(2, "0")}:00`).join(" & ");
}

export default function AdminPage() {
  const [state, setState] = useState<SyncState | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "warn" | "error"; text: string } | null
  >(null);
  // Ticking clock so the cooldown countdown updates every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Seconds left before another manual fetch is allowed (server enforces the
  // same window; this just mirrors it so the button shows a live countdown).
  const throttleS = state?.throttleSeconds ?? 60;
  const cooldownLeft = state?.lastSyncedAt
    ? Math.max(
        0,
        Math.ceil(throttleS - (now - new Date(state.lastSyncedAt).getTime()) / 1000),
      )
    : 0;

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sync", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as SyncState);
    } catch {
      /* the status panel simply stays empty on a transient failure */
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const runSync = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sync", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await res.json()) as SyncResponse;

      if (res.status === 401) {
        setMessage({ kind: "error", text: "Token admin salah atau kosong." });
      } else if (res.status === 429 || data.throttled) {
        setMessage({
          kind: "warn",
          text:
            data.error ??
            `Terlalu sering. Tunggu ${data.retryAfter ?? throttleS} detik.`,
        });
      } else if (data.fetchStatus === "success") {
        setMessage({
          kind: "ok",
          text: `Berhasil menarik ${data.count} berita (data lengkap).`,
        });
      } else if (data.fetchStatus === "incomplete") {
        setMessage({
          kind: "warn",
          text: "Fetch berhasil tetapi data kurang lengkap — tetap memakai data lama.",
        });
      } else {
        setMessage({
          kind: "error",
          text: data.ok
            ? "Fetch gagal total — tetap memakai data lama."
            : (data.error ?? "Fetch gagal dan belum ada data lama."),
        });
      }
      // Merge so the auto-fetch/token info from the GET is preserved (the POST
      // response only carries the freshly-synced counts).
      if (data.state) {
        const next = data.state;
        setState((prev) => ({ ...prev, ...next }));
      } else loadState();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Gagal menghubungi server.",
      });
    } finally {
      setLoading(false);
    }
  }, [token, loadState]);

  return (
    <main className="flex h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-b from-kendari-deep to-kendari-deepblue px-4 py-4 text-white">
      <div className="flex w-full max-w-md flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="size-10 shrink-0">
            <Logo className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-lg font-extrabold leading-tight tracking-tight">
              Admin — Kendari News Kiosk
            </h1>
            <p className="text-xs text-blue-100/70">
              Kelola sinkronisasi berita ke database
            </p>
          </div>
        </div>

        {/* Status — compact stat row */}
        <section className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/15 bg-white/5 p-3 text-center backdrop-blur-md">
            <Database className="mx-auto mb-1 size-4 text-blue-100/60" />
            <div className="font-heading text-2xl font-extrabold tabular-nums leading-none">
              {state?.totalPosts ?? "—"}
            </div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-blue-100/60">
              Berita
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 p-3 text-center backdrop-blur-md">
            <Clock className="mx-auto mb-1 size-4 text-blue-100/60" />
            <div className="font-heading text-sm font-bold leading-tight">
              {formatSchedule(state?.autoFetchTimes)}
            </div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-blue-100/60">
              Auto-fetch WITA
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 p-3 text-center backdrop-blur-md">
            <RefreshCw className="mx-auto mb-1 size-4 text-blue-100/60" />
            <div
              className={`font-heading text-sm font-bold leading-tight ${statusBadge(state?.lastStatus ?? null).cls}`}
            >
              {statusBadge(state?.lastStatus ?? null).label}
            </div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-blue-100/60">
              Fetch terakhir
            </div>
          </div>
        </section>

        {/* Last successful sync line */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm">
          <span className="text-blue-100/60">Terakhir diperbarui pada</span>
          <span className="font-medium text-blue-50">
            {formatWhen(state?.lastSuccessAt ?? null)}
          </span>
        </div>

        {/* Notice when the most recent attempt wasn't a clean success. The kiosk
            keeps showing the last good data (above); this flags that the newest
            fetch was incomplete (amber) or failed (red) and old data is in use. */}
        {state?.lastStatus && state.lastStatus !== "success" && (
          <div
            className={`rounded-xl border px-4 py-2.5 text-xs ${
              state.lastStatus === "incomplete"
                ? "border-amber-400/30 bg-amber-500/10"
                : "border-red-400/30 bg-red-500/10"
            }`}
          >
            <div
              className={`font-semibold ${
                state.lastStatus === "incomplete" ? "text-amber-100" : "text-red-100"
              }`}
            >
              {state.lastStatus === "incomplete"
                ? "Data kurang lengkap"
                : "Percobaan terakhir gagal"}
            </div>
            <div
              className={`mt-0.5 ${
                state.lastStatus === "incomplete" ? "text-amber-100/80" : "text-red-100/80"
              }`}
            >
              {describeStatus(state.lastStatus)}
            </div>
            <div
              className={`mt-0.5 ${
                state.lastStatus === "incomplete" ? "text-amber-100/60" : "text-red-100/60"
              }`}
            >
              {formatWhen(state.lastSyncedAt ?? null)}
            </div>
          </div>
        )}

        {/* Action panel */}
        <section className="rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur-md">
          <p className="mb-3 text-xs leading-relaxed text-blue-100/70">
            Paksa tarik artikel terbaru dari sumber (langsung, tanpa cache) ke
            database Neon. Jika hasilnya gagal/kurang lengkap, data lama tetap
            dipakai. Otomatis juga berjalan sesuai jadwal di atas.
          </p>

          {state?.tokenRequired && (
            <div className="mb-3">
              <label
                htmlFor="token"
                className="mb-1 block text-[0.65rem] uppercase tracking-wide text-blue-100/60"
              >
                Token Admin
              </label>
              <div className="relative">
                <input
                  id="token"
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loading) {
                      e.preventDefault();
                      runSync();
                    }
                  }}
                  placeholder="Masukkan ADMIN_TOKEN"
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 pr-11 text-sm text-white placeholder:text-blue-100/40 focus:border-kendari-sky focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Sembunyikan token" : "Tampilkan token"}
                  aria-pressed={showToken}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-blue-100/60 transition-colors hover:text-white"
                >
                  {showToken ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={runSync}
            disabled={loading || cooldownLeft > 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-heading text-sm font-bold text-white shadow-lg transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Menyinkronkan…
              </>
            ) : cooldownLeft > 0 ? (
              <>
                <Clock className="size-4" />
                Tunggu {cooldownLeft} detik
              </>
            ) : (
              <>
                <RefreshCw className="size-4" />
                Fetch Ulang Sekarang
              </>
            )}
          </button>

          {message && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
                message.kind === "ok"
                  ? "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30"
                  : message.kind === "warn"
                    ? "bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30"
                    : "bg-red-500/15 text-red-100 ring-1 ring-red-400/30"
              }`}
            >
              {message.text}
            </p>
          )}
        </section>

        <a
          href="/"
          className="text-center text-xs font-medium text-blue-100/70 underline-offset-4 hover:text-white hover:underline"
        >
          ← Kembali ke tampilan kiosk
        </a>
      </div>
    </main>
  );
}
