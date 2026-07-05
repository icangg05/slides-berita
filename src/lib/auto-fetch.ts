/**
 * Background auto-fetch — keeps the Neon database fresh without anyone pressing
 * "Fetch Ulang" in the admin page. Started once at server boot from
 * `src/instrumentation.ts`. Runs ONLY in the Node.js server runtime.
 *
 * Cadence is clock-based: it fires at the WITA times in `FETCH_TIMES`
 * (default "0,12" → 00:00 & 12:00). Each fire pulls from the SPPD relay, so we
 * keep scrape.do usage predictable (2×/day) regardless of kiosk traffic.
 */

import {
  getFetchTimes,
  formatFetchTimes,
  msUntilNextFire,
  minGapMs,
} from "./fetch-schedule";
import { getSyncState, syncPosts } from "./db";

// Survive dev hot-reload / double-import: a single scheduler per process.
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

/** Arm a one-shot timer for the next fire, then re-arm itself after it runs. */
function scheduleNext(times: number[]): void {
  const delay = msUntilNextFire(times);
  if (!Number.isFinite(delay)) return;
  const timer = setTimeout(() => {
    void (async () => {
      await runSync("scheduled");
      scheduleNext(times); // arm the following fire
    })();
  }, delay);
  // Don't keep the event loop alive solely for this timer.
  timer.unref?.();
}

export function startAutoFetch(): void {
  if (globalRef.__kioskAutoFetchStarted) return;
  globalRef.__kioskAutoFetchStarted = true;

  const times = getFetchTimes();
  if (times.length === 0) {
    console.log('[auto-fetch] disabled (set FETCH_TIMES, e.g. "0,12")');
    return;
  }

  console.log(
    `[auto-fetch] enabled — daily at ${formatFetchTimes(times)} WITA`,
  );

  // Startup catch-up: if data last landed more than one interval ago (or never),
  // sync now so a restarted server isn't serving stale/empty data until the next
  // clock time. A restart within the interval won't re-fetch (saves credits).
  void (async () => {
    try {
      const state = await getSyncState();
      const last = state.lastSuccessAt
        ? new Date(state.lastSuccessAt).getTime()
        : 0;
      if (Date.now() - last >= minGapMs(times)) {
        await runSync("startup catch-up");
      }
    } catch (err) {
      console.error("[auto-fetch] startup check failed:", err);
    }
  })();

  scheduleNext(times);
}
