import type { NewsItem } from "./types";

/**
 * WordPress REST *source* layer for the Kendari news kiosk.
 *
 * The public source is the Diskominfo Kota Kendari newsroom. This module is now
 * ONLY the upstream fetcher: it is called during a sync (see `src/lib/db.ts`)
 * to pull fresh articles from WordPress. The kiosk itself never reads from here
 * directly — it reads the copy cached in the Neon database, so page loads stay
 * fast and don't repeatedly hit the upstream API.
 */

const WP_API_BASE =
  (typeof window === "undefined" ? process.env.WP_API_BASE : null)?.replace(/\/$/, "") ??
  "https://berita.kendarikota.go.id/wp-json/wp/v2";

/**
 * Optional shared-secret header for the upstream fetch. When the source sits
 * behind Cloudflare (or any WAF) that blocks Vercel's datacenter IPs, the site
 * owner can add a WAF "Skip" rule that allows requests carrying this header, and
 * we send it here. Configure both env vars to enable; unset ⇒ nothing is sent
 * (no behaviour change).
 *
 *   WP_BYPASS_HEADER  e.g. "X-Kiosk-Key"
 *   WP_BYPASS_TOKEN   the secret value the WAF rule matches on
 */
function bypassHeaders(): Record<string, string> {
  const name = process.env.WP_BYPASS_HEADER?.trim();
  const value = process.env.WP_BYPASS_TOKEN;
  return name && value ? { [name]: value } : {};
}

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
  title: WpRendered;
  excerpt: WpRendered;
  content: WpRendered;
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
  return {
    id: post.id,
    title: toPlainText(post.title.rendered),
    excerpt: toPlainText(post.excerpt.rendered),
    contentHtml: sanitizeContent(post.content.rendered),
    date: post.date,
    dateLabel: formatDateLabel(post.date),
    category: pickCategory(post._embedded?.["wp:term"]),
    imageUrl: image,
    // Full-size original (uncropped) so the lightbox can show the whole frame.
    imageFullUrl: media?.source_url ?? image,
    imageAlt: media?.alt_text
      ? toPlainText(media.alt_text)
      : toPlainText(post.title.rendered),
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

// --- Public API (upstream source only) -------------------------------------

/**
 * Pull the latest headlines straight from the WordPress newsroom.
 *
 * Used exclusively by the sync job. `cache: "no-store"` guarantees a real
 * upstream hit (an admin pressing "Fetch ulang" must get genuinely fresh data,
 * not a Next.js data-cache replay). The list endpoint already embeds full
 * `content.rendered`, so a single list fetch gives us everything the detail
 * pages need too.
 */
export async function fetchPostsFromSource(count = NEWS_COUNT): Promise<NewsItem[]> {
  // orderby=date&order=desc → newest article first, down to the oldest.
  const url = `${WP_API_BASE}/posts?per_page=${count}&_embed&orderby=date&order=desc`;
  // The upstream sits behind a WAF that occasionally answers a legitimate
  // request with 403/429/5xx (rate limiting). Retry a couple of times with a
  // short backoff before giving up, so a spurious block doesn't fail the sync.
  // A browser-like User-Agent also placates WAFs that reject the default one.
  const MAX_ATTEMPTS = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; KendariNewsKiosk/1.0; +https://berita.kendarikota.go.id)",
          ...bypassHeaders(),
        },
      });
      if (res.ok) {
        const data = (await res.json()) as WpPost[];
        return data.map(normalize);
      }
      lastError = `posts fetch failed: ${res.status} ${res.statusText}`;
      // 4xx other than the WAF-ish 403/429 won't fix themselves — fail fast.
      if (res.status !== 403 && res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  throw new Error(lastError || "posts fetch failed");
}
