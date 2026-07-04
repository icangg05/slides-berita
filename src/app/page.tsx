import { getPostsForDisplay } from "@/lib/db";
import { Kiosk } from "@/components/Kiosk";

// Read straight from Neon on every request (the DB read is fast — that's the
// whole point). Fresh articles land in the table when an admin runs a sync at
// /admin; the kiosk also polls /api/posts in the background.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const posts = await getPostsForDisplay();
  return <Kiosk initialPosts={posts} />;
}
