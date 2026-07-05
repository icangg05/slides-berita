/**
 * Parsing for `FETCH_TIMES` — the daily clock times (in WITA / Asia/Makassar)
 * when the background sync runs.
 *
 * Value is a comma-separated list of 24-hour hours:
 *   "0,12"  → 00:00 and 12:00 WITA (midnight & noon)  ← kiosk default
 *   "6"     → once a day at 06:00 WITA
 *   ""/unset/invalid → auto-fetch disabled
 *
 * WITA has no DST and is a fixed UTC+8, so a clock time maps to one absolute
 * instant per day regardless of the server's own timezone.
 */

export const WITA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse the raw env into a sorted, de-duplicated list of valid WITA hours. */
export function parseFetchTimes(raw: string | undefined | null): number[] {
  if (!raw) return [];
  const hours = raw
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

/** Configured daily fire times in WITA hours (empty = disabled). */
export function getFetchTimes(): number[] {
  return parseFetchTimes(process.env.FETCH_TIMES);
}

/** "0,12" → "00:00, 12:00" for logs and the admin panel. */
export function formatFetchTimes(times: number[]): string {
  return times.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ");
}

/**
 * Milliseconds from `now` until the next scheduled fire. Works purely in epoch
 * math: a WITA wall-clock hour `h` corresponds to the instant `Date.UTC(y,mo,d,h)
 * - WITA_OFFSET_MS`. Returns Infinity when no times are configured.
 */
export function msUntilNextFire(times: number[], now: number = Date.now()): number {
  if (times.length === 0) return Infinity;
  // Shift into WITA wall-clock so UTC getters read the local Y/M/D.
  const wita = new Date(now + WITA_OFFSET_MS);
  const y = wita.getUTCFullYear();
  const mo = wita.getUTCMonth();
  const d = wita.getUTCDate();

  let soonest = Infinity;
  for (const h of times) {
    let epoch = Date.UTC(y, mo, d, h, 0, 0, 0) - WITA_OFFSET_MS;
    if (epoch <= now) epoch += DAY_MS; // already passed today → tomorrow
    soonest = Math.min(soonest, epoch - now);
  }
  return soonest;
}

/**
 * Smallest cyclic gap between consecutive fires — the "one interval" used to
 * decide a startup catch-up. For "0,12" it's 12h; for a single daily time, 24h.
 */
export function minGapMs(times: number[]): number {
  if (times.length <= 1) return DAY_MS;
  const sorted = [...times].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 24;
    min = Math.min(min, (next - sorted[i]) * 60 * 60 * 1000);
  }
  return min;
}
