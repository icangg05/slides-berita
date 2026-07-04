import { NextResponse } from "next/server";
import { getPostsForDisplay } from "@/lib/db";

/**
 * Same-origin JSON feed the running kiosk polls in the background to refresh
 * its headlines without a full page reload. Reads from the Neon database (not
 * the upstream WordPress API), so it's fast and cheap to hit frequently.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const posts = await getPostsForDisplay();
    return NextResponse.json({ posts, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[api/posts] read failed:", err);
    return NextResponse.json(
      { posts: [], fetchedAt: new Date().toISOString(), error: "read_failed" },
      { status: 500 },
    );
  }
}
