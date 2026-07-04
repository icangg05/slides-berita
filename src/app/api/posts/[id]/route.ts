import { NextResponse } from "next/server";
import { getPost } from "@/lib/db";

/**
 * Same-origin JSON for a single stored article — the client-side fallback the
 * detail view uses when the server render didn't have the post. Reads from Neon.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return NextResponse.json({ post: null, error: "bad_id" }, { status: 400 });
  }
  try {
    const post = await getPost(postId);
    if (!post) {
      return NextResponse.json({ post: null }, { status: 404 });
    }
    return NextResponse.json({ post });
  } catch (err) {
    console.error(`[api/posts/${postId}] read failed:`, err);
    return NextResponse.json({ post: null, error: "read_failed" }, { status: 500 });
  }
}
