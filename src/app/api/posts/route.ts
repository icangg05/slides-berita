import { NextResponse } from "next/server";
import { fetchPosts } from "@/lib/wp";

/**
 * Same-origin proxy the running kiosk polls in the background so it can refresh
 * headlines without a full page reload (and without exposing the client to
 * CORS on the upstream WordPress host). Cached via ISR at the fetch layer.
 */
// Literal required by Next's static analysis; mirrors REVALIDATE_SECONDS.
export const revalidate = 300;

export async function GET() {
  const posts = await fetchPosts();
  return NextResponse.json(
    { posts, fetchedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    },
  );
}
