"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Clock, Database, RefreshCw } from "lucide-react";
import { Logo } from "@/components/Logo";

interface SyncState {
  lastSyncedAt: string | null;
  lastStatus: string | null;
  totalPosts: number;
  tokenRequired?: boolean;
  autoFetchHours?: number;
}

interface SyncResponse {
  ok: boolean;
  count: number;
  syncedAt: string;
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

function formatInterval(hours: number | undefined): string {
  if (!hours || hours <= 0) return "Nonaktif";
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "Tiap 1 hari" : `Tiap ${days} hari`;
  }
  return hours === 1 ? "Tiap 1 jam" : `Tiap ${hours} jam`;
}

export default function AdminPage() {
  const [state, setState] = useState<SyncState | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

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
      } else if (data.ok) {
        setMessage({
          kind: "ok",
          text: `Berhasil menarik ${data.count} berita dari sumber.`,
        });
      } else {
        setMessage({
          kind: "error",
          text: data.error ?? "Gagal menyinkronkan berita.",
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
              {formatInterval(state?.autoFetchHours)}
            </div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-blue-100/60">
              Auto-fetch
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 p-3 text-center backdrop-blur-md">
            <RefreshCw className="mx-auto mb-1 size-4 text-blue-100/60" />
            <div
              className={`font-heading text-sm font-bold leading-tight ${
                state?.lastStatus === "ok"
                  ? "text-emerald-300"
                  : state?.lastStatus
                    ? "text-amber-300"
                    : ""
              }`}
            >
              {state?.lastStatus === "ok"
                ? "OK"
                : state?.lastStatus
                  ? "Perlu cek"
                  : "—"}
            </div>
            <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-blue-100/60">
              Status
            </div>
          </div>
        </section>

        {/* Last sync line */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm">
          <span className="text-blue-100/60">Sinkron terakhir</span>
          <span className="font-medium text-blue-50">
            {formatWhen(state?.lastSyncedAt ?? null)}
          </span>
        </div>

        {/* Action panel */}
        <section className="rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur-md">
          <p className="mb-3 text-xs leading-relaxed text-blue-100/70">
            Tarik artikel terbaru dari sumber WordPress ke database Neon. Data
            juga tersegarkan otomatis di latar belakang sesuai interval di atas.
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
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-heading text-sm font-bold text-white shadow-lg transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Menyinkronkan…
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
