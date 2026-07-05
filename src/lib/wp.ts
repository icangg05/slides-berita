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
      // 4xx (other than 429) won't fix itself on retry — fail fast.
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  throw new Error(lastError || `${label} fetch failed`);
}

/** Envelope returned by the SPPD relay: `{ ok, via, jumlah, data: WpPost[] }`. */
interface SppdBeritaResponse {
  ok?: boolean;
  via?: string;
  jumlah?: number;
  data?: WpPost[];
}

/**
 * Pull the latest headlines via the SPPD relay (WordPress through scrape.do).
 * The relay returns the raw WP payload with full `content.rendered` + `_embedded`,
 * so a single fetch gives us everything the detail pages need too. This is the
 * ONE place that touches the upstream — called by the server sync job (db.ts).
 */
export async function fetchPostsFromSource(count = NEWS_COUNT): Promise<NewsItem[]> {
  const body = await fetchJson<SppdBeritaResponse>(SPPD_BERITA_URL, "posts");
  const posts = Array.isArray(body?.data) ? body.data : [];
  // scrape.do occasionally returns a malformed batch (right length, but posts
  // missing their `title`/`content` — e.g. a partial Cloudflare response). Keep
  // ONLY well-formed posts (numeric id + non-empty title). If a whole batch is
  // junk this yields [], and syncPosts' empty-guard preserves the good Neon copy
  // rather than clobbering it. Relay is newest-first, capped at 20.
  return posts
    .filter(
      (p) =>
        typeof p?.id === "number" &&
        typeof p.title?.rendered === "string" &&
        p.title.rendered.trim() !== "",
    )
    .slice(0, count)
    .map(normalize);
}
