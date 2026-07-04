import { NextResponse } from "next/server";
import { getSyncState, syncPosts } from "@/lib/db";
import { getFetchIntervalHours } from "@/lib/fetch-schedule";

/**
 * Admin endpoint that (re)fetches articles from the WordPress source into Neon.
 *
 *  • GET  → current sync status (last run, article count) — used by /admin.
 *  • POST → run a fresh sync now. Protected by ADMIN_TOKEN when it is set;
 *           if ADMIN_TOKEN is unset the endpoint is open (convenient for local
 *           dev — set the token in production to lock it down).
 */
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // no token configured → open (dev convenience)
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

export async function GET() {
  try {
    const state = await getSyncState();
    return NextResponse.json({
      ...state,
      tokenRequired: Boolean(process.env.ADMIN_TOKEN),
      autoFetchHours: getFetchIntervalHours(),
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
  const result = await syncPosts();
  const state = await getSyncState().catch(() => null);
  return NextResponse.json(
    { ...result, state },
    { status: result.ok ? 200 : 502 },
  );
}
