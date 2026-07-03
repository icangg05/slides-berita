import "server-only";
import type { NewsItem } from "./types";

/**
 * WordPress REST data layer for the Kendari news kiosk.
 *
 * The public source is the Diskominfo Kota Kendari newsroom. All fetches use
 * Next.js ISR (`revalidate`) so the running kiosk transparently picks up fresh
 * headlines every few minutes without a redeploy — satisfying the PRD's
 * "fetch berkala setiap 5-10 menit" requirement.
 */

const WP_API_BASE =
  process.env.WP_API_BASE?.replace(/\/$/, "") ??
  "https://berita.kendarikota.go.id/wp-json/wp/v2";

/** How many headlines the slideshow rotates through (PRD F-01: 20). */
export const NEWS_COUNT = 20;

/** Revalidation window in seconds (PRD: refresh every 5–10 minutes). */
export const REVALIDATE_SECONDS = 300;

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
    dateLabel: safeDateLabel(post.date),
    category: pickCategory(post._embedded?.["wp:term"]),
    imageUrl: image,
    imageAlt: media?.alt_text
      ? toPlainText(media.alt_text)
      : toPlainText(post.title.rendered),
    author: post._embedded?.author?.[0]?.name ?? "Redaksi",
    link: post.link,
  };
}

function safeDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${dateFormatter.format(d)} WITA`;
}

// --- Public API ------------------------------------------------------------

/** Fetch the latest headlines for the slideshow (PRD F-01). */
export async function fetchPosts(count = NEWS_COUNT): Promise<NewsItem[]> {
  // orderby=date&order=desc → newest article first, down to the oldest.
  const url = `${WP_API_BASE}/posts?per_page=${count}&_embed&orderby=date&order=desc`;
  try {
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`[wp] posts fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = (await res.json()) as WpPost[];
    return data.map(normalize);
  } catch (err) {
    console.error("[wp] posts fetch error:", err);
    return [];
  }
}

/** Fetch a single article for the detail page (PRD F-02). */
export async function fetchPost(id: number): Promise<NewsItem | null> {
  const url = `${WP_API_BASE}/posts/${id}?_embed`;
  try {
    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as WpPost;
    return normalize(data);
  } catch (err) {
    console.error(`[wp] post ${id} fetch error:`, err);
    return null;
  }
}
