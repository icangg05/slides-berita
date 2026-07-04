/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to kick off the background auto-fetch loop (DB-backed sync on a
 * schedule). Guarded to the Node.js runtime so it never runs on the Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAutoFetch } = await import("./lib/auto-fetch");
  startAutoFetch();
}
