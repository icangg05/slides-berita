import { NextResponse } from "next/server";
import { getSyncState, syncPosts } from "@/lib/db";
import { getFetchIntervalHours } from "@/lib/fetch-schedule";

/**
 * Scheduled sync endpoint — driven by Vercel Cron (see `vercel.json`).
 *
 * Why this exists: on Vercel there is no long-lived Node process, so the
 * `setInterval` loop in `src/lib/auto-fetch.ts` never fires reliably in
 * production. Vercel Cron pings this route on a fixed schedule instead, and the
 * route re-runs the same `syncPosts()` the admin button uses.
 *
 * The cron ticks hourly (the finest Vercel granularity we need). `FETCH_INTERVAL_HOURS`
 * still governs the *effective* cadence: if the last success is newer than one
 * interval we skip, so a multi-day interval (e.g. "24*3") doesn't sync every hour.
 * A failed/never-run state always falls through and retries on the next tick.
 */
export const dynamic = "force-dynamic";
// Give the sync room for upstream retries/backoff + the upsert transaction.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the env var is
  // set. If it isn't configured the route is open (Vercel Cron requests still
  // reach it; anyone else could too, so setting CRON_SECRET is recommended).
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hours = getFetchIntervalHours();
  if (hours > 0) {
    const state = await getSyncState().catch(() => null);
    const lastSuccess = state?.lastSuccessAt
      ? new Date(state.lastSuccessAt).getTime()
      : 0;
    const dueAt = lastSuccess + hours * 60 * 60 * 1000;
    if (lastSuccess > 0 && Date.now() < dueAt) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "not_due",
        nextDueAt: new Date(dueAt).toISOString(),
      });
    }
  }

  const result = await syncPosts();
  console.log(
    `[cron/sync] ok=${result.ok} count=${result.count}` +
      (result.error ? ` error=${result.error}` : ""),
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
