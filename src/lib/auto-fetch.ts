/**
 * Background auto-fetch — keeps the Neon database fresh without anyone pressing
 * "Fetch ulang" in the admin page. Started once at server boot from
 * `src/instrumentation.ts`. Runs ONLY in the Node.js server runtime.
 *
 * Cadence comes from `FETCH_INTERVAL_HOURS` (see `fetch-schedule.ts`).
 */

import { getFetchIntervalHours } from "./fetch-schedule";
import { getSyncState, syncPosts } from "./db";

// Survive dev hot-reload / double-import: a single interval per process.
const globalRef = globalThis as unknown as {
  __kioskAutoFetchStarted?: boolean;
};

async function runSync(reason: string): Promise<void> {
  try {
    const res = await syncPosts();
    console.log(
      `[auto-fetch] ${reason}: ok=${res.ok} count=${res.count}` +
        (res.error ? ` error=${res.error}` : ""),
    );
  } catch (err) {
    console.error("[auto-fetch] sync threw:", err);
  }
}

export function startAutoFetch(): void {
  if (globalRef.__kioskAutoFetchStarted) return;
  globalRef.__kioskAutoFetchStarted = true;

  // On Vercel there is no persistent process, so `setInterval` won't fire
  // reliably — scheduling is handled by Vercel Cron hitting /api/cron/sync
  // (see vercel.json). This in-process loop is only for local/long-running dev.
  if (process.env.VERCEL) {
    console.log("[auto-fetch] on Vercel — scheduling handled by cron, skipping interval");
    return;
  }

  const hours = getFetchIntervalHours();
  if (hours <= 0) {
    console.log(
      "[auto-fetch] disabled (set FETCH_INTERVAL_HOURS to enable, e.g. 1 or 24*3)",
    );
    return;
  }

  const intervalMs = hours * 60 * 60 * 1000;
  console.log(`[auto-fetch] enabled — every ${hours} hour(s)`);

  // Catch-up on boot: if the last sync is older than one interval (or never),
  // fetch now so a restarted server isn't serving stale data until the first
  // tick. Otherwise wait for the schedule — no redundant hit on every restart.
  void (async () => {
    try {
      const state = await getSyncState();
      const last = state.lastSyncedAt
        ? new Date(state.lastSyncedAt).getTime()
        : 0;
      if (Date.now() - last >= intervalMs) {
        await runSync("startup catch-up");
      }
    } catch (err) {
      console.error("[auto-fetch] startup check failed:", err);
    }
  })();

  const timer = setInterval(() => void runSync("scheduled"), intervalMs);
  // Don't keep the event loop alive solely for this timer.
  timer.unref?.();
}
