/**
 * Parsing for `FETCH_INTERVAL_HOURS` — the background auto-fetch interval.
 *
 * The value is expressed in HOURS, but may be written as a simple
 * multiplication so multi-day intervals stay readable:
 *   "3"    → every 3 hours
 *   "1"    → every hour
 *   "24*3" → every 3 days (72 hours)
 *   "0" / unset / invalid → auto-fetch disabled
 */

export function parseIntervalHours(raw: string | undefined | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  // Support a plain number or a chain of `*` multiplications (e.g. "24*3").
  const parts = trimmed.split("*").map((p) => Number(p.trim()));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return 0;
  const hours = parts.reduce((acc, n) => acc * n, 1);
  return hours > 0 ? hours : 0;
}

/** Configured auto-fetch interval in hours (0 = disabled). */
export function getFetchIntervalHours(): number {
  return parseIntervalHours(process.env.FETCH_INTERVAL_HOURS);
}
