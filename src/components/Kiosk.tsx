"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { LockButton } from "./LockButton";
import { Logo } from "./Logo";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { LoadingScreen } from "./LoadingScreen";
import { fetchPosts } from "@/lib/wp";

const SLIDE_MS = 9000; // PRD F-01: 8–10s per slide.
const POLL_MS = 5 * 60 * 1000; // PRD §6: refresh headlines every ~5 min.
const RESUME_MS = 4000; // resume motion this long after the last touch.
const LOCK_REVEAL_MS = 4000; // keep the lock icon shown this long after a tap.
const IDLE_LOCK_MS = 5 * 60 * 1000; // auto-lock after 5 min with no interaction.
const LS_KEY = "kendari-kiosk-locked";

function sameOrder(a: NewsItem[], b: NewsItem[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i]?.id);
}

/**
 * The kiosk stage (PRD F-01 + F-03 + layout).
 *
 *  • Starts LOCKED; the lock state is remembered in localStorage.
 *  • While locked the lock icon is HIDDEN; a screen tap briefly reveals it
 *    (with a shake) so staff can hold it to unlock, then it hides again.
 *  • Detail is reached ONLY via the "Baca selengkapnya" button.
 *  • Slide dots jump between articles (when unlocked).
 *  • Any touch freezes the progress bar, image zoom and ticker (resume on idle).
 *  • After 5 minutes with no interaction the screen auto-locks.
 */
export function Kiosk({ initialPosts }: { initialPosts: NewsItem[] }) {
  const router = useRouter();
  const [posts, setPosts] = useState<NewsItem[]>(initialPosts);
  const [index, setIndex] = useState(0);
  const [locked, setLocked] = useState(true); // default locked
  const [paused, setPaused] = useState(false);
  const [hintTick, setHintTick] = useState(0);
  const [lockRevealed, setLockRevealed] = useState(false);
  const [navLoading, setNavLoading] = useState(false);
  // Mount veil: shown on arrival (e.g. coming back from a detail page) for a
  // controlled minimum time, then eased away — never a too-fast flash.
  const [bootVeil, setBootVeil] = useState(true);
  const [bootOut, setBootOut] = useState(false);

  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useClientFetchRef = useRef(false);

  const current = posts[index] ?? posts[0];

  // Persisting setter for the lock state.
  const setLockedPersist = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setLocked((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        try {
          localStorage.setItem(LS_KEY, String(next));
        } catch {}
        return next;
      });
    },
    [],
  );

  // Restore the remembered lock state on mount (persist the default if unset).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved !== null) setLocked(saved === "true");
      else localStorage.setItem(LS_KEY, "true");
    } catch {}
  }, []);

  // --- Idle auto-lock (5 min) ---------------------------------------------
  const armIdleLock = useCallback(() => {
    if (idleLockTimer.current) clearTimeout(idleLockTimer.current);
    idleLockTimer.current = setTimeout(
      () => setLockedPersist(true),
      IDLE_LOCK_MS,
    );
  }, [setLockedPersist]);

  useEffect(() => {
    armIdleLock();
    return () => {
      if (idleLockTimer.current) clearTimeout(idleLockTimer.current);
    };
  }, [armIdleLock]);

  // --- Client-side fallback fetch on mount if initialPosts is empty --------
  useEffect(() => {
    if (posts.length > 0) return;

    async function loadInitialPostsClient() {
      try {
        const fetched = await fetchPosts();
        if (fetched && fetched.length > 0) {
          useClientFetchRef.current = true;
          setPosts(fetched);
        }
      } catch (err) {
        console.error("Client initial fetch error:", err);
      }
    }
    loadInitialPostsClient();
  }, [posts.length]);

  // --- Background refresh (live newsroom) ---------------------------------
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        let fetched: NewsItem[] = [];
        if (posts.length === 0 || useClientFetchRef.current) {
          fetched = await fetchPosts();
        } else {
          const res = await fetch("/api/posts", { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as { posts?: NewsItem[] };
            fetched = data.posts ?? [];
          } else {
            // If server-side api fails, switch to direct client fetch
            useClientFetchRef.current = true;
            fetched = await fetchPosts();
          }
        }

        if (fetched && fetched.length > 0) {
          setPosts((prev) =>
            sameOrder(prev, fetched) ? prev : fetched,
          );
        }
      } catch {
        /* transient network blip on the kiosk — keep showing cached slides */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [posts.length]);

  useEffect(() => {
    if (index >= posts.length && posts.length > 0) setIndex(0);
  }, [posts.length, index]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      if (lockHideTimer.current) clearTimeout(lockHideTimer.current);
    },
    [],
  );

  // Mount veil timing: hold ~700ms (not a flash), then fade out over ~500ms.
  useEffect(() => {
    const t1 = setTimeout(() => setBootOut(true), 700);
    const t2 = setTimeout(() => setBootVeil(false), 700 + 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // --- Interaction: freeze motion, reveal + shake lock when locked --------
  const handleInteract = useCallback(
    (e: React.PointerEvent) => {
      armIdleLock(); // any touch resets the 5-min auto-lock countdown
      const onLockBtn = (e.target as HTMLElement).closest("[data-lockbtn]");

      if (locked) {
        // Reveal the lock icon and keep it up for a short window.
        setLockRevealed(true);
        if (lockHideTimer.current) clearTimeout(lockHideTimer.current);
        lockHideTimer.current = setTimeout(
          () => setLockRevealed(false),
          LOCK_REVEAL_MS,
        );
        // Shake only when tapping the screen (not the lock button itself).
        if (!onLockBtn) setHintTick((t) => t + 1);
      }

      if (onLockBtn) return; // lock interactions don't freeze the slideshow

      setPaused(true);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => setPaused(false), RESUME_MS);
    },
    [locked, armIdleLock],
  );

  const advance = useCallback(() => {
    if (posts.length > 1) setIndex((i) => (i + 1) % posts.length);
  }, [posts.length]);

  const openDetail = useCallback(() => {
    if (locked || !current) return; // detail only when unlocked
    // Fade a loading veil in immediately so the transition never feels abrupt;
    // it keeps showing while the detail route streams (loading.tsx picks it up).
    setNavLoading(true);
    router.push(`/berita/${current.id}`);
  }, [locked, current, router]);

  const goToSlide = useCallback(
    (i: number) => {
      if (locked) return; // dots inert while locked
      setIndex(i);
    },
    [locked],
  );

  const activeSet = new Set(
    posts.length
      ? [
          index,
          (index + 1) % posts.length,
          (index - 1 + posts.length) % posts.length,
        ]
      : [],
  );

  if (!current) {
    return <EmptyState />;
  }

  return (
    <main
      onPointerDown={handleInteract}
      className="kiosk-surface relative mx-auto flex h-[100dvh] w-full max-w-[1080px] flex-col overflow-hidden bg-gradient-to-b from-kendari-deep to-kendari-deepblue"
    >
      {/* ---- Header (opaque top bar — no longer covers the photo) ---- */}
      <Header headlines={posts.map((p) => p.title)} paused={paused} />

      {/* ---- Hero region: the featured image lives here, fully visible ---- */}
      <section className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 z-0">
          {posts.map((post, i) => (
            <div
              key={post.id}
              className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
              style={{ opacity: i === index ? 1 : 0 }}
              aria-hidden={i !== index}
            >
              {post.imageUrl ? (
                <div
                  className={`h-full w-full ${i === index ? "animate-ken-burns" : ""}`}
                  style={{ animationPlayState: paused ? "paused" : "running" }}
                >
                  <Image
                    src={post.imageUrl}
                    alt=""
                    fill
                    {...(i === 0
                      ? { priority: true }
                      : { loading: activeSet.has(i) ? "eager" : "lazy" })}
                    sizes="(max-width: 1080px) 100vw, 1080px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-kendari-deep to-kendari-deepblue" />
              )}
            </div>
          ))}

          {/* Bottom scrim only — keeps the glass card legible over the photo. */}
          <div className="absolute inset-0 bg-gradient-to-t from-kendari-deepblue via-kendari-deepblue/35 to-transparent" />
        </div>

        {/* Glass content card — overlays the bottom of the photo */}
        <Card className="absolute inset-x-3 bottom-2 z-10 gap-0 rounded-2xl border-white/15 bg-white/10 p-4 py-4 text-left shadow-2xl backdrop-blur-md sm:inset-x-5 sm:p-6 lg:inset-x-6 lg:bottom-3 lg:rounded-3xl lg:p-8">
          <div className="mb-2 flex flex-wrap items-center gap-2 lg:mb-4 lg:gap-3">
            <Badge
              variant="default"
              className="px-3 py-1 font-heading text-[0.65rem] font-bold uppercase tracking-wide lg:px-4 lg:py-1.5 lg:text-sm"
            >
              {current.category}
            </Badge>
            <span className="text-xs font-medium text-blue-100/80 sm:text-sm lg:text-base">
              {current.dateLabel}
            </span>
          </div>

          <h1 className="line-clamp-3 font-heading text-2xl font-extrabold leading-[1.1] tracking-tight text-white drop-shadow-md sm:text-3xl lg:text-[2.75rem]">
            {current.title}
          </h1>

          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-blue-50/90 sm:text-base lg:mt-4 lg:line-clamp-4 lg:text-2xl">
            {current.excerpt}
          </p>

          <div className="mt-3 flex items-center justify-between gap-2 lg:mt-6">
            <span className="truncate text-xs font-medium text-blue-100/70 sm:text-sm lg:text-lg">
              oleh {current.author}
            </span>
            <Button
              type="button"
              onClick={openDetail}
              variant="glass"
              size="sm"
              className="shrink-0 font-heading text-[0.7rem] sm:text-sm lg:h-11 lg:px-5 lg:text-base"
            >
              <span className="hidden sm:inline">
                Sentuh untuk baca selengkapnya
              </span>
              <span className="sm:hidden">Baca selengkapnya</span>
              <ArrowRight className="size-4 lg:size-5" />
            </Button>
          </div>

          {/* Auto-advance progress bar (also the autoplay timer). */}
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15 lg:mt-6">
            <div
              key={index}
              onAnimationEnd={advance}
              className="h-full origin-left rounded-full bg-primary"
              style={{
                animation: `progress-grow ${SLIDE_MS}ms linear forwards`,
                animationPlayState: paused ? "paused" : "running",
              }}
            />
          </div>

          {/* Slide dots — clickable to jump (when unlocked) */}
          <div className="mt-2.5 flex flex-wrap gap-1.5 lg:mt-4">
            {posts.map((p, i) => (
              <button
                key={p.id}
                type="button"
                aria-label={`Berita ${i + 1}`}
                onClick={() => goToSlide(i)}
                className={`h-2.5 rounded-full transition-all duration-500 lg:h-3 ${
                  locked ? "cursor-default" : "cursor-pointer"
                } ${
                  i === index
                    ? "w-7 bg-white lg:w-9"
                    : "w-2.5 bg-white/30 hover:bg-white/60 lg:w-3"
                }`}
              />
            ))}
          </div>
        </Card>
      </section>

      <Footer />

      {/* ---- Floating lockdown button (hidden while locked until tapped) ---- */}
      <LockButton
        locked={locked}
        visible={!locked || lockRevealed}
        hintTick={hintTick}
        onToggle={() => setLockedPersist((v) => !v)}
      />

      {/* ---- Navigation loading veil (fades in on "Baca selengkapnya") ---- */}
      {navLoading && (
        <div className="animate-veil-in fixed inset-0 z-[80]">
          <LoadingScreen />
        </div>
      )}

      {/* ---- Mount veil (shown on arrival, e.g. back from detail), fades out ---- */}
      {bootVeil && (
        <div
          className={`fixed inset-0 z-[85] transition-opacity duration-500 ease-out ${
            bootOut ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          aria-hidden
        >
          <LoadingScreen />
        </div>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <main className="kiosk-surface flex h-[100dvh] flex-col items-center justify-center gap-6 bg-gradient-to-b from-kendari-deep to-kendari-deepblue px-10 text-center">
      <div className="relative grid size-32 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-white/15 border-t-kendari-sky" />
        <div className="size-20">
          <Logo className="h-full w-full" />
        </div>
      </div>
      <h1 className="font-heading text-3xl font-bold text-white lg:text-4xl">
        Kendari News Kiosk
      </h1>
      <p className="max-w-lg text-lg text-blue-100/70 lg:text-xl">
        Sedang menghubungkan ke pusat berita Kota Kendari. Konten akan tampil
        secara otomatis begitu tersedia.
      </p>
    </main>
  );
}
