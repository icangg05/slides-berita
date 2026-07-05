import { neon } from "@neondatabase/serverless";
import type { NewsItem } from "./types";
import { fetchPostsFromSource, formatDateLabel, NEWS_COUNT } from "./wp";

/**
 * Neon (Postgres) data layer — the kiosk's source of truth at read time.
 *
 * Flow:
 *   WordPress newsroom ──(sync)──▶ Neon `posts` table ──(read)──▶ kiosk UI
 *
 * The UI (home slideshow + article detail) reads ONLY from this database, so
 * page loads are fast and don't repeatedly hammer the upstream WordPress API.
 * Fresh data lands in the table when a sync runs — triggered manually from the
 * admin page (`/admin`) or automatically as a one-time seed when the table is
 * still empty (cold start).
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail loud and early rather than throwing a cryptic error deep in a query.
  console.error("[db] DATABASE_URL is not set — the kiosk cannot read articles.");
}

const sql = neon(connectionString ?? "");

// --- Schema ----------------------------------------------------------------

let schemaReady: Promise<void> | null = null;

/** Create the tables on first use (idempotent). Memoised per process. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS posts (
          id             BIGINT PRIMARY KEY,
          title          TEXT        NOT NULL,
          excerpt        TEXT        NOT NULL DEFAULT '',
          content_html   TEXT        NOT NULL DEFAULT '',
          date           TIMESTAMPTZ NOT NULL,
          category       TEXT        NOT NULL DEFAULT 'Berita',
          image_url      TEXT,
          image_full_url TEXT,
          image_alt      TEXT        NOT NULL DEFAULT '',
          author         TEXT        NOT NULL DEFAULT 'Redaksi',
          link           TEXT        NOT NULL DEFAULT '',
          synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS posts_date_desc_idx ON posts (date DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS sync_state (
          id              INT PRIMARY KEY DEFAULT 1,
          last_synced_at  TIMESTAMPTZ,
          last_success_at TIMESTAMPTZ,
          post_count      INT  NOT NULL DEFAULT 0,
          last_status     TEXT,
          CONSTRAINT sync_state_singleton CHECK (id = 1)
        )
      `;
      // Migrate older deployments that predate the last_success_at column.
      await sql`ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ`;
    })().catch((err) => {
      // Reset so a transient failure (e.g. DB asleep) can be retried next call.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// --- Row ⇄ NewsItem mapping -------------------------------------------------

interface PostRow {
  id: string | number;
  title: string;
  excerpt: string;
  content_html: string;
  date: string | Date;
  category: string;
  image_url: string | null;
  image_full_url: string | null;
  image_alt: string;
  author: string;
  link: string;
}

function rowToItem(r: PostRow): NewsItem {
  const iso = new Date(r.date).toISOString();
  return {
    id: Number(r.id),
    title: r.title,
    excerpt: r.excerpt,
    contentHtml: r.content_html,
    date: iso,
    // Recompute the label on read so it always reflects the current formatter.
    dateLabel: formatDateLabel(iso),
    category: r.category,
    imageUrl: r.image_url,
    imageFullUrl: r.image_full_url,
    imageAlt: r.image_alt,
    author: r.author,
    link: r.link,
  };
}

// --- Reads (what the kiosk serves) -----------------------------------------

/** Latest headlines, newest first. Pure DB read — no upstream hit. */
export async function getPosts(limit = NEWS_COUNT): Promise<NewsItem[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM posts ORDER BY date DESC LIMIT ${limit}
  `) as PostRow[];
  return rows.map(rowToItem);
}

/** A single stored article by its WordPress id. */
export async function getPost(id: number): Promise<NewsItem | null> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM posts WHERE id = ${id} LIMIT 1
  `) as PostRow[];
  return rows[0] ? rowToItem(rows[0]) : null;
}

async function countPosts(): Promise<number> {
  const rows = (await sql`SELECT count(*)::int AS n FROM posts`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Headlines for display, with a cold-start safety net: if the table is still
 * empty (nobody has run a sync yet) we seed it once from the source so a fresh
 * deployment isn't a blank screen. Once populated, this is a plain DB read.
 */
export async function getPostsForDisplay(limit = NEWS_COUNT): Promise<NewsItem[]> {
  const rows = await getPosts(limit);
  if (rows.length > 0) return rows;
  try {
    const result = await syncPosts();
    if (result.count > 0) return getPosts(limit);
  } catch (err) {
    console.error("[db] cold-start seed failed:", err);
  }
  return [];
}

// --- Writes (sync) ---------------------------------------------------------

export interface SyncResult {
  ok: boolean;
  count: number;
  syncedAt: string;
  error?: string;
}

/**
 * Upsert a batch of articles keyed by WordPress id — all-or-nothing.
 *
 * The whole batch runs in a single transaction so a mid-batch failure (e.g. the
 * DB connection dropping after row 10) can never leave Neon with a partially
 * updated set. Either every article lands or none do.
 */
async function upsertPosts(items: NewsItem[]): Promise<void> {
  if (items.length === 0) return;
  const queries = items.map(
    (it) => sql`
      INSERT INTO posts (
        id, title, excerpt, content_html, date, category,
        image_url, image_full_url, image_alt, author, link, synced_at
      ) VALUES (
        ${it.id}, ${it.title}, ${it.excerpt}, ${it.contentHtml}, ${it.date}, ${it.category},
        ${it.imageUrl}, ${it.imageFullUrl}, ${it.imageAlt}, ${it.author}, ${it.link}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        title          = EXCLUDED.title,
        excerpt        = EXCLUDED.excerpt,
        content_html   = EXCLUDED.content_html,
        date           = EXCLUDED.date,
        category       = EXCLUDED.category,
        image_url      = EXCLUDED.image_url,
        image_full_url = EXCLUDED.image_full_url,
        image_alt      = EXCLUDED.image_alt,
        author         = EXCLUDED.author,
        link           = EXCLUDED.link,
        synced_at      = now()
    `,
  );
  await sql.transaction(queries);
}

/**
 * Record the outcome of a sync attempt. `last_synced_at` tracks the last attempt
 * (success or not) so the admin can see recency; `last_success_at` only advances
 * on a genuine success, so a later failed attempt (e.g. a transient 403 from the
 * source) never erases the fact that fresh data did land earlier.
 */
async function recordSync(
  count: number,
  status: string,
  ok: boolean,
): Promise<void> {
  await sql`
    INSERT INTO sync_state (id, last_synced_at, last_success_at, post_count, last_status)
    VALUES (
      1, now(), CASE WHEN ${ok} THEN now() ELSE NULL END, ${count}, ${status}
    )
    ON CONFLICT (id) DO UPDATE SET
      last_synced_at  = now(),
      last_success_at = CASE WHEN ${ok} THEN now() ELSE sync_state.last_success_at END,
      post_count      = ${count},
      last_status     = ${status}
  `;
}

/**
 * Pull the latest articles from the WordPress source and upsert them into Neon.
 * This is the ONE place that hits the upstream API. Older rows are kept (the
 * kiosk only ever shows the newest `NEWS_COUNT`), so previously linked detail
 * pages keep working.
 */
export async function syncPosts(count = NEWS_COUNT): Promise<SyncResult> {
  await ensureSchema();
  try {
    const items = await fetchPostsFromSource(count);
    if (items.length === 0) {
      // Don't clobber good data with an empty upstream response.
      await recordSync(await countPosts(), "empty", false);
      return {
        ok: false,
        count: 0,
        syncedAt: new Date().toISOString(),
        error: "Sumber berita tidak mengembalikan artikel.",
      };
    }
    await upsertPosts(items);
    const total = await countPosts();
    await recordSync(total, "ok", true);
    return { ok: true, count: items.length, syncedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[db] sync failed:", message);
    try {
      await recordSync(await countPosts(), `error: ${message}`, false);
    } catch {
      /* recording the failure is best-effort */
    }
    return {
      ok: false,
      count: 0,
      syncedAt: new Date().toISOString(),
      error: message,
    };
  }
}

// --- Sync status (for the admin page) --------------------------------------

export interface SyncState {
  /** When the last sync *attempt* ran (success or failure). */
  lastSyncedAt: string | null;
  /** When data last *successfully* landed — unaffected by later failures. */
  lastSuccessAt: string | null;
  lastStatus: string | null;
  totalPosts: number;
}

export async function getSyncState(): Promise<SyncState> {
  await ensureSchema();
  const rows = (await sql`
    SELECT last_synced_at, last_success_at, last_status FROM sync_state WHERE id = 1
  `) as {
    last_synced_at: string | null;
    last_success_at: string | null;
    last_status: string | null;
  }[];
  const total = await countPosts();
  return {
    lastSyncedAt: rows[0]?.last_synced_at
      ? new Date(rows[0].last_synced_at).toISOString()
      : null,
    lastSuccessAt: rows[0]?.last_success_at
      ? new Date(rows[0].last_success_at).toISOString()
      : null,
    lastStatus: rows[0]?.last_status ?? null,
    totalPosts: total,
  };
}
