import type { NewsItem } from "./types";

/**
 * WordPress *source* layer for the Kendari news kiosk.
 *
 * The upstream is the Diskominfo Kota Kendari newsroom, but we do NOT reach it
 * directly: its Cloudflare WAF blocks datacenter IPs (Vercel/VPS). Instead we go
 * through the SPPD relay endpoint, which fetches WordPress via scrape.do (a
 * residential IP) and returns the raw WordPress payload. See:
 *   sppd-update/routes/web.php → /uji-coba/berita
 *
 * This module is ONLY the upstream fetcher: it runs during a server-side sync
 * (see `src/lib/db.ts`) to mirror fresh articles into Neon. The kiosk UI never
 * calls it — it reads the cached copy from Neon, so page loads stay fast and no
 * scrape.do credits are spent per view.
 */

const SPPD_BERITA_URL =
  process.env.SPPD_BERITA_URL?.replace(/\/$/, "") ??
  "https://sppd.ilmifaizan.cloud/uji-coba/berita";

/** How many headlines the slideshow rotates through (PRD F-01: 20). */
export const NEWS_COUNT = 20;

// --- Raw REST payload (only the fields we touch) --------------------------

interface WpRendered {
  rendered: string;
}

interface WpMediaSize {
  source_url: string;
  width: number;
}

interface WpMedia {
  source_url?: string;
  alt_text?: string;
  media_details?: { sizes?: Record<string, WpMediaSize> };
}

interface WpTerm {
  name: string;
  taxonomy: string;
}

interface WpPost {
  id: number;
  date: string;
  link: string;
  // Optional because the payload is proxied via scrape.do — a stray malformed
  // post shouldn't be assumed to carry every rendered sub-object.
  title?: WpRendered;
  excerpt?: WpRendered;
  content?: WpRendered;
  _embedded?: {
    author?: Array<{ name?: string }>;
    "wp:featuredmedia"?: WpMedia[];
    "wp:term"?: WpTerm[][];
  };
}

// --- HTML helpers ----------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&#8217;": "’",
  "&#8216;": "‘",
  "&#8220;": "“",
  "&#8221;": "”",
  "&#8211;": "–",
  "&#8212;": "—",
};

function decodeEntities(input: string): string {
  return input
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|hellip|#0?39|#8217|#8216|#8220|#8221|#8211|#8212);/g,
      (m) => ENTITIES[m] ?? m,
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Strip all tags → plain text. Used for titles and slideshow excerpts. */
function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Light sanitiser for the detail page's rich HTML. The source is a trusted
 * government CMS, but we still remove active content and inline event handlers
 * before it reaches `dangerouslySetInnerHTML`.
 */
function sanitizeContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed|form|link|meta)[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

// --- Field extractors ------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Makassar",
});

function pickImage(media?: WpMedia): string | null {
  if (!media) return null;
  const sizes = media.media_details?.sizes;
  if (sizes) {
    // Prefer a crisp, wide-ish size for the 1080px-wide portrait hero.
    const preferred = [
      "jnews-1140x815",
      "jnews-1140x570",
      "large",
      "jnews-750x536",
      "medium_large",
    ];
    for (const key of preferred) {
      if (sizes[key]?.source_url) return sizes[key].source_url;
    }
    // Otherwise take the widest available.
    const widest = Object.values(sizes).sort((a, b) => b.width - a.width)[0];
    if (widest?.source_url) return widest.source_url;
  }
  return media.source_url ?? null;
}

function pickCategory(terms?: WpTerm[][]): string {
  const flat = (terms ?? []).flat();
  const cat = flat.find((t) => t.taxonomy === "category" && t.name);
  return cat?.name ?? flat[0]?.name ?? "Berita";
}

function normalize(post: WpPost): NewsItem {
  const media = post._embedded?.["wp:featuredmedia"]?.[0];
  const image = pickImage(media);
  // Defensive field access: the relay proxies a third party (scrape.do), so an
  // occasional post could arrive without a `rendered` sub-object. Fall back to
  // empty strings rather than throwing and failing the whole all-or-nothing sync.
  const title = toPlainText(post.title?.rendered ?? "");
  return {
    id: post.id,
    title,
    excerpt: toPlainText(post.excerpt?.rendered ?? ""),
    contentHtml: sanitizeContent(post.content?.rendered ?? ""),
    date: post.date,
    dateLabel: formatDateLabel(post.date),
    category: pickCategory(post._embedded?.["wp:term"]),
    imageUrl: image,
    // Full-size original (uncropped) so the lightbox can show the whole frame.
    imageFullUrl: media?.source_url ?? image,
    imageAlt: media?.alt_text ? toPlainText(media.alt_text) : title,
    author: post._embedded?.author?.[0]?.name ?? "Redaksi",
    link: post.link,
  };
}

/**
 * Human date label in id-ID / WITA. Exported so the database layer can recompute
 * it when serving stored rows (the raw ISO date is what we persist).
 */
export function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dateFormatter.format(d)} WITA`;
}

// --- Public API (upstream source) ------------------------------------------

/**
 * GET + parse JSON from the SPPD relay with a small retry/backoff. The relay can
 * answer 502 when scrape.do momentarily fails, or 429 under rate limiting, so we
 * retry those a couple of times before giving up. Runs server-side only.
 */
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.ok) return (await res.json()) as T;
      lastError = `${label} fetch failed: ${res.status} ${res.statusText}`;
      // Only 429 is worth retrying. A 5xx from the relay means it already tried
      // upstream and has nothing to serve — retrying just re-charges scrape.do.
      if (res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  throw new Error(lastError || `${label} fetch failed`);
}

/** Outcome the relay reports for a fetch attempt. */
export type FetchStatus = "success" | "incomplete" | "failed";

/** Envelope returned by the SPPD relay. */
interface SppdBeritaResponse {
  ok?: boolean;
  fetch_status?: string; // success | incomplete | failed
  served?: string; // fresh | last-good | cache | none
  data?: WpPost[];
}

export interface SourceResult {
  /** Complete, normalised articles the relay served (fresh OR last-good copy). */
  items: NewsItem[];
  /** What happened upstream this attempt (drives the /admin status). */
  status: FetchStatus;
  /** Which copy the relay served: fresh | last-good | cache | none. */
  served: string;
}

/**
 * Pull the latest headlines via the SPPD relay (WordPress through scrape.do).
 * We always send `?force=1` so the relay skips its serve-fresh cache and fetches
 * live — both the scheduled sync and the /admin button want the freshest data.
 *
 * The relay is the gate: on a fully-complete fetch it serves fresh data
 * (`status: success`); on a failed or incomplete fetch it serves the last-good
 * copy instead (`status: failed | incomplete`) so we never propagate junk. This
 * is the ONE place that touches the upstream — called by the server sync (db.ts).
 */
export async function fetchPostsFromSource(count = NEWS_COUNT): Promise<SourceResult> {
  try {
    const body = await fetchJson<SppdBeritaResponse>(`${SPPD_BERITA_URL}?force=1`, "posts");
    const raw = body.fetch_status;
    const status: FetchStatus =
      raw === "success" || raw === "incomplete" || raw === "failed"
        ? raw
        : body.ok
          ? "success"
          : "failed";
    const posts = Array.isArray(body?.data) ? body.data : [];
    // Defensive: keep only well-formed posts (numeric id + non-empty title).
    const items = posts
      .filter(
        (p) =>
          typeof p?.id === "number" &&
          typeof p.title?.rendered === "string" &&
          p.title.rendered.trim() !== "",
      )
      .slice(0, count)
      .map(normalize);
    return { items, status, served: body.served ?? "" };
  } catch {
    // Relay 502 (no data at all) or a network error → total failure, no data.
    return { items: [], status: "failed", served: "none" };
  }
}
