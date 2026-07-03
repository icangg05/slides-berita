import { fetchPost, fetchPosts } from "@/lib/wp";
import { DetailView } from "@/components/DetailView";
import { BeritaMissing } from "@/components/BeritaMissing";

// Literal required by Next's static analysis; mirrors REVALIDATE_SECONDS.
export const revalidate = 300;

export default async function BeritaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const postId = Number(id);

  // A missing/removed article must degrade to the graceful auto-return screen
  // rather than a dead 404, so the kiosk never gets stuck.
  if (!Number.isInteger(postId) || postId <= 0) return <BeritaMissing />;

  // Fetch the article and the current headline list in parallel — the list
  // lets us compute the "next berita" for the end-of-article auto-advance.
  // Catch errors so server rendering doesn't crash, allowing the client to fetch.
  const [post, list] = await Promise.all([
    fetchPost(postId).catch(() => null),
    fetchPosts().catch(() => []),
  ]);

  const idx = list ? list.findIndex((p) => p.id === postId) : -1;
  const nextId =
    list && list.length > 0
      ? idx >= 0
        ? list[(idx + 1) % list.length].id
        : list[0].id
      : null;

  return (
    <DetailView
      postId={postId}
      initialPost={post}
      initialNextId={nextId}
    />
  );
}
