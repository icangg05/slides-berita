/** Normalised shape the UI actually consumes — decoupled from the raw
 *  WordPress REST payload so components never touch `_embedded` gymnastics. */
export interface NewsItem {
  id: number;
  title: string; // plain text, entities decoded
  excerpt: string; // plain text summary
  contentHtml: string; // sanitised rich HTML (detail page only)
  date: string; // ISO date string
  dateLabel: string; // human label in id-ID / WITA
  category: string;
  imageUrl: string | null; // best-fit featured image (may be a cropped size)
  imageFullUrl: string | null; // full-size original — used when enlarged
  imageAlt: string;
  author: string;
  link: string; // canonical source URL
}
