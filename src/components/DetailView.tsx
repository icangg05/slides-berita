"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, X, ZoomIn } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Logo } from "./Logo";
import { Footer } from "./Footer";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { LoadingScreen } from "./LoadingScreen";
import { fetchPost, fetchPosts } from "@/lib/wp";
import { BeritaMissing } from "./BeritaMissing";

const RESUME_IDLE_MS = 2000; // resume auto-scroll this long after last touch.
const AUTO_SCROLL_PXPS = 40; // auto-scroll speed (px / second).
const START_DELAY_MS = 1600; // let the reader see the top before scrolling.
const NEXT_COUNTDOWN = 10; // seconds at the end before the next article.

/**
 * Interactive article reader (PRD F-02, extended).
 *
 *  • Auto-scrolls through the article at a calm pace (duration scales with
 *    length). Any interaction pauses it; it resumes after a few idle seconds.
 *  • Tap the cover or any in-content image to enlarge it (lightbox).
 *  • Links inside the article are inert (a kiosk must never leave the site).
 *  • At the end, a 10-second countdown advances to the next berita.
 */
export function DetailView({
  postId,
  initialPost,
  initialNextId,
}: {
  postId: number;
  initialPost: NewsItem | null;
  initialNextId: number | null;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [post, setPost] = useState<NewsItem | null>(initialPost);
  const [nextId, setNextId] = useState<number | null>(initialNextId);
  const [clientLoading, setClientLoading] = useState(!initialPost);
  const [clientError, setClientError] = useState(false);

  const [interacting, setInteracting] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxClosing, setLightboxClosing] = useState(false);
  const [leaving, setLeaving] = useState(false); // veil while navigating home

  // Loading veil: shown on mount (data is ready), then eased away so the
  // article doesn't pop in abruptly.
  const [showVeil, setShowVeil] = useState(true);
  const [veilOut, setVeilOut] = useState(false);

  // Client side fetch if not loaded server-side (fallback for Vercel blocking)
  useEffect(() => {
    if (post) return;

    async function loadPostClient() {
      try {
        setClientLoading(true);
        const [fetchedPost, fetchedList] = await Promise.all([
          fetchPost(postId),
          fetchPosts(),
        ]);
        if (!fetchedPost) {
          setClientError(true);
          return;
        }
        setPost(fetchedPost);
        const idx = fetchedList.findIndex((p) => p.id === postId);
        const computedNextId =
          fetchedList.length > 0
            ? idx >= 0
              ? fetchedList[(idx + 1) % fetchedList.length].id
              : fetchedList[0].id
            : null;
        setNextId(computedNextId);
      } catch (err) {
        console.error("Client detail fetch error:", err);
        setClientError(true);
      } finally {
        setClientLoading(false);
      }
    }

    loadPostClient();
  }, [postId, post]);

  // Loading veil timing: hold ~450ms, then fade out over ~700ms.
  // Wait until clientLoading is done if it is fetching client-side.
  useEffect(() => {
    if (clientLoading) return;
    const t1 = setTimeout(() => setVeilOut(true), 450);
    const t2 = setTimeout(() => setShowVeil(false), 450 + 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [clientLoading]);

  // Refs mirror state so the rAF loop / listeners read fresh values.
  const interactingRef = useRef(false);
  const lightboxRef = useRef(false);
  const startedRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lightboxRef.current = lightboxSrc !== null;
  }, [lightboxSrc]);

  const goHome = useCallback(() => {
    setLeaving(true); // fade a loading veil in before leaving for the slideshow
    router.push("/");
  }, [router]);
  const goNext = useCallback(() => {
    // Fade the loading veil in first so the auto-advance to the next article
    // never pops in abruptly (mirrors the "back to home" transition).
    setLeaving(true);
    router.push(nextId != null ? `/berita/${nextId}` : "/");
  }, [nextId, router]);

  const markInteract = useCallback(() => {
    setInteracting(true);
    interactingRef.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setInteracting(false);
      interactingRef.current = false;
    }, RESUME_IDLE_MS);
  }, []);

  // --- Auto-scroll loop + interaction listeners ---------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    let last = performance.now();
    const startT = setTimeout(() => {
      startedRef.current = true;
    }, START_DELAY_MS);

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const max = el.scrollHeight - el.clientHeight;
      if (
        startedRef.current &&
        !interactingRef.current &&
        !lightboxRef.current &&
        el.scrollTop < max - 0.5
      ) {
        el.scrollTop = Math.min(max, el.scrollTop + AUTO_SCROLL_PXPS * dt);
      }
      const end = max <= 2 || el.scrollTop >= max - 2;
      setAtEnd((prev) => (prev === end ? prev : end));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const events: Array<keyof HTMLElementEventMap> = [
      "wheel",
      "touchstart",
      "touchmove",
      "pointerdown",
    ];
    events.forEach((e) =>
      el.addEventListener(e, markInteract, { passive: true }),
    );
    window.addEventListener("keydown", markInteract);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(startT);
      events.forEach((e) => el.removeEventListener(e, markInteract));
      window.removeEventListener("keydown", markInteract);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [markInteract]);

  // --- Countdown to the next berita once idle at the end ------------------
  useEffect(() => {
    if (!atEnd || interacting || lightboxSrc !== null) {
      setCountdown(null);
      return;
    }
    setCountdown(NEXT_COUNTDOWN);
    const id = setInterval(
      () => setCountdown((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [atEnd, interacting, lightboxSrc]);

  useEffect(() => {
    if (countdown === 0) goNext();
  }, [countdown, goNext]);

  // Enlarge in-content images; links are already inert (CSS pointer-events).
  const onContentClick = useCallback((e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest("img");
    if (img) {
      e.preventDefault();
      const el = img as HTMLImageElement;
      const src = el.currentSrc || el.src;
      if (src) {
        setLightboxClosing(false);
        setLightboxSrc(src);
      }
    }
  }, []);

  // Close the lightbox with an out-animation instead of an abrupt removal.
  const closeLightbox = useCallback(() => {
    setLightboxClosing(true);
    setTimeout(() => {
      setLightboxSrc(null);
      setLightboxClosing(false);
    }, 200);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (clientError) {
    return <BeritaMissing />;
  }

  if (!post) {
    return (
      <main className="relative mx-auto flex h-[100dvh] w-full max-w-[1080px] select-none flex-col overflow-hidden bg-kendari-slate text-kendari-deep">
        <LoadingScreen />
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex h-[100dvh] w-full max-w-[1080px] select-none flex-col overflow-hidden bg-kendari-slate text-kendari-deep">
      {/* ---- Top bar ---- */}
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 bg-kendari-deep px-4 py-3 text-white shadow-lg sm:px-6 lg:px-8 lg:py-5">
        <Button
          onClick={goHome}
          variant="glass"
          className="h-10 gap-2 rounded-full px-4 font-heading text-sm font-bold sm:text-base lg:h-auto lg:px-6 lg:py-3.5 lg:text-xl"
        >
          <ArrowLeft className="size-5 lg:size-6" strokeWidth={2.4} />
          <span className="hidden sm:inline">Kembali ke Berita</span>
          <span className="sm:hidden">Kembali</span>
        </Button>

        {/* Institutional identity — same as the home header (logo + text). */}
        <div className="flex min-w-0 items-center gap-2.5 lg:gap-4">
          <div className="size-10 shrink-0 sm:size-12 lg:size-14">
            <Logo className="h-full w-full" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-heading text-sm font-extrabold tracking-tight text-white sm:text-base lg:text-xl">
              Kota Kendari
            </p>
            <p className="truncate text-[0.7rem] font-medium text-blue-100/85 sm:text-xs lg:text-sm">
              Dinas Komunikasi dan Informatika
            </p>
          </div>
        </div>
      </header>

      {/* ---- Scrollable article ----
           The scroll box is absolutely sized inside this wrapper so the
           end-of-article overlay never changes its height (which would make
           "at end" flip on/off and flicker the countdown). */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="detail-scroll absolute inset-0">
        {/* Hero — tap to enlarge */}
        <button
          type="button"
          onClick={() => {
            if (post.imageUrl) {
              setLightboxClosing(false);
              setLightboxSrc(post.imageUrl);
            }
          }}
          aria-label="Perbesar gambar sampul"
          className="group relative block h-[38vh] w-full cursor-zoom-in bg-kendari-deepblue sm:h-[42vh] lg:h-[46vh]"
        >
          {post.imageUrl ? (
            <Image
              src={post.imageUrl}
              alt=""
              fill
              priority
              sizes="(max-width: 1080px) 100vw, 1080px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-kendari-deep to-kendari-deepblue" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-kendari-slate to-transparent" />
          <Badge
            variant="default"
            className="absolute left-4 top-4 px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wide shadow-lg sm:left-6 lg:left-8 lg:top-6 lg:text-sm"
          >
            {post.category}
          </Badge>
          {post.imageUrl && (
            <span className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm lg:right-8 lg:top-6 lg:size-11">
              <ZoomIn className="size-5 lg:size-6" />
            </span>
          )}
        </button>

        {/* Body — extra bottom padding leaves room for the countdown overlay */}
        <article className="px-5 pb-28 pt-2 sm:px-8 lg:px-10 lg:pb-36">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-kendari-deep/70 sm:text-base lg:mb-5 lg:text-lg">
            <span>{post.dateLabel}</span>
            <span className="text-kendari-deep/30">•</span>
            <span>oleh {post.author}</span>
          </div>

          <h1 className="font-heading text-[1.75rem] font-extrabold leading-[1.1] tracking-tight text-kendari-deep sm:text-4xl lg:text-[2.9rem] lg:leading-[1.08]">
            {post.title}
          </h1>

          <div className="mt-6 h-px w-full bg-kendari-deep/10 lg:mt-8" />

          <div
            className="wp-content mt-6 text-base leading-relaxed text-slate-800 sm:text-lg lg:mt-8 lg:text-[1.35rem]"
            onClick={onContentClick}
            // Content is sanitised in lib/wp.ts; links are inert via CSS.
            dangerouslySetInnerHTML={{ __html: post.contentHtml }}
          />

          {/* Back-to-top */}
          <div className="mt-10 flex justify-center lg:mt-14">
            <Button
              type="button"
              onClick={scrollToTop}
              variant="ghost"
              className="gap-2 rounded-full border border-kendari-deep/20 px-6 py-2.5 font-heading text-sm font-bold text-kendari-deep hover:bg-kendari-deep/5 lg:h-12 lg:px-8 lg:text-base"
            >
              <ArrowUp className="size-5" strokeWidth={2.4} />
              Kembali ke atas
            </Button>
          </div>
        </article>
        </div>

        {/* ---- End-of-article "next berita" countdown (overlay) ---- */}
        {countdown !== null && (
          <div className="animate-rise-in absolute inset-x-0 bottom-0 z-30 border-t border-kendari-accent/30 bg-kendari-deep px-5 py-3 text-white shadow-2xl lg:px-10 lg:py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-kendari-accent font-heading text-lg font-extrabold tabular-nums lg:size-14 lg:text-2xl">
                {countdown}
              </span>
              <div className="leading-tight">
                <p className="font-heading text-sm font-bold sm:text-base lg:text-xl">
                  Berita selanjutnya
                </p>
                <p className="text-xs text-blue-100/70 lg:text-sm">
                  Sentuh untuk terus membaca
                </p>
              </div>
            </div>
            <Button
              onClick={goNext}
              variant="glass"
              className="h-10 gap-2 rounded-full px-4 font-heading text-sm font-bold lg:h-12 lg:px-6 lg:text-base"
            >
              Lihat sekarang
              <ArrowRight className="size-4 lg:size-5" />
            </Button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-kendari-accent transition-[width] duration-1000 ease-linear"
              style={{ width: `${(countdown / NEXT_COUNTDOWN) * 100}%` }}
            />
          </div>
          </div>
        )}
      </div>

      <Footer />

      {/* ---- Lightbox (animated open + close) ---- */}
      {lightboxSrc && (
        <div
          className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 ${
            lightboxClosing ? "animate-backdrop-out" : "animate-backdrop-in"
          }`}
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt=""
            className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl ${
              lightboxClosing ? "animate-lightbox-out" : "animate-lightbox-in"
            }`}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            aria-label="Tutup"
            className="absolute right-5 top-5 grid size-12 cursor-pointer place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-white/25"
          >
            <X className="size-6" />
          </button>
        </div>
      )}

      {/* ---- Leaving veil — fades in while navigating back to the slideshow ---- */}
      {leaving && (
        <div className="animate-veil-in fixed inset-0 z-[80]">
          <LoadingScreen />
        </div>
      )}

      {/* ---- Loading veil — covers the page on mount, then eases away ---- */}
      {showVeil && (
        <div
          className={`pointer-events-none fixed inset-0 z-[70] transition-opacity duration-700 ease-out ${
            veilOut ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden
        >
          <LoadingScreen />
        </div>
      )}
    </main>
  );
}
