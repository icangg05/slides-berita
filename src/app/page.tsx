import { fetchPosts } from "@/lib/wp";
import { Kiosk } from "@/components/Kiosk";

// Regenerate the initial payload periodically (PRD: live newsroom).
// Must be a literal — Next statically analyses this. Keep in sync with
// REVALIDATE_SECONDS in src/lib/wp.ts.
export const revalidate = 300;

export default async function HomePage() {
  const posts = await fetchPosts();
  return <Kiosk initialPosts={posts} />;
}
