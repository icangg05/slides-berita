import { NextResponse } from "next/server";
import { getSyncState, syncPosts } from "@/lib/db";
import { getFetchTimes } from "@/lib/fetch-schedule";

/**
 * Admin endpoint that (re)fetches articles from the WordPress source into Neon.
 *
 *  • GET  → current sync status (last run, article count) — used by /admin.
 *  • POST → run a fresh sync now. Protected by ADMIN_TOKEN when it is set;
 *           if ADMIN_TOKEN is unset the endpoint is open (convenient for local
 *           dev — set the token in production to lock it down).
 */
export const dynamic = "force-dynamic";

// Minimum gap between manual syncs. Server-enforced so the /admin button can't
// be spammed (e.g. by refreshing) and each press costs a scrape.do call. Based
// on the last sync ATTEMPT, so failed attempts count too (protects credits).
const THROTTLE_S = 60;

function authorized(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // no token configured → open (dev convenience)
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

/** Seconds still to wait before another sync is allowed (0 = allowed now). */
function cooldownLeft(lastSyncedAt: string | null): number {
  if (!lastSyncedAt) return 0;
  const elapsed = (Date.now() - new Date(lastSyncedAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(THROTTLE_S - elapsed));
}

export async function GET() {
  try {
    const state = await getSyncState();
    return NextResponse.json({
      ...state,
      tokenRequired: Boolean(process.env.ADMIN_TOKEN),
      autoFetchTimes: getFetchTimes(),
      throttleSeconds: THROTTLE_S,
    });
  } catch (err) {
    console.error("[api/admin/sync] state read failed:", err);
    return NextResponse.json({ error: "state_read_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Server-side throttle: reject if a sync ran less than THROTTLE_S ago.
  const prev = await getSyncState().catch(() => null);
  const wait = cooldownLeft(prev?.lastSyncedAt ?? null);
  if (wait > 0) {
    return NextResponse.json(
      {
        ok: false,
        throttled: true,
        retryAfter: wait,
        error: `Terlalu sering. Tunggu ${wait} detik sebelum menarik lagi.`,
        state: prev,
      },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const result = await syncPosts();
  const state = await getSyncState().catch(() => null);
  return NextResponse.json(
    { ...result, state },
    { status: result.ok ? 200 : 502 },
  );
}
