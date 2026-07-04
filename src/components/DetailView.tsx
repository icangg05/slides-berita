"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Logo } from "./Logo";
import { Footer } from "./Footer";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { LoadingScreen } from "./LoadingScreen";
import { BeritaMissing } from "./BeritaMissing";

/** Fetch a single stored article from our own DB-backed API. */
async function fetchPostFromApi(id: number): Promise<NewsItem | null> {
  const res = await fetch(`/api/posts/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { post?: NewsItem | null };
  return data.post ?? null;
}

/** Fetch the current headline list from our own DB-backed API. */
async function fetchPostsFromApi(): Promise<NewsItem[]> {
  const res = await fetch("/api/posts", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as { posts?: NewsItem[] };
  return data.posts ?? [];
}

const RESUME_IDLE_MS = 1500; // resume auto-scroll this long after last touch.
const AUTO_SCROLL_PXPS = 40; // auto-scroll speed (px / second).
const START_DELAY_MS = 1600; // let the reader see the top before scrolling.
const NEXT_COUNTDOWN = 10; // seconds at the end before the next article.
const SCROLL_RAMP_MS = 1400; // ease the scroll speed up from 0 → full so it never jerks into motion.

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
  const scrollRef = useRef<HTMLDivElement | null>(null); // the clipping viewport
  const contentRef = useRef<HTMLDivElement | null>(null); // the translated content
  const posRef = useRef(0); // current scroll offset in px (float, we own it)
  const progressRef = useRef<HTMLDivElement | null>(null); // scroll-progress bar fill

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
          fetchPostFromApi(postId),
          fetchPostsFromApi(),
        ]);
        if (!fetchedPost) {
          setClientError(true);
          return;
        }
        setPost(fetchedPost);
        const idx = fetchedList.findIndex((p) => p.id === postId);
        // No wrap: the LAST article yields null -> goNext() returns home.
        const computedNextId =
          fetchedList.length > 0
            ? idx >= 0
              ? idx < fetchedList.length - 1
                ? fetchedList[idx + 1].id
                : null // last article -> home
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

  // Loading veil: fade out immediately once data is ready — no artificial hold.
  // (Still waits for the client-side fetch if the server render had no post.)
  // Only a short crossfade remains so the article doesn't pop in abruptly.
  useEffect(() => {
    if (clientLoading) return;
    setVeilOut(true);
    const t = setTimeout(() => setShowVeil(false), 700);
    return () => clearTimeout(t);
  }, [clientLoading]);

  // Refs mirror state so the rAF loop / listeners read fresh values.
  const interactingRef = useRef(false);
  const lightboxRef = useRef(false);
  const startedRef = useRef(false);
  const holdingRef = useRef(false); // true while a finger/pointer is held down.
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
  // We move the article with a GPU-composited transform instead of the native
  // scrollTop. scrollTop changes force a repaint of the whole scrollport each
  // frame (janky with big images) and snap to whole pixels (stutter at slow
  // speed). A translate3d layer is composited sub-pixel with no repaint — so
  // the crawl is smooth. Because we now own the position, manual input (drag /
  // wheel) is applied to the same offset.
  useEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    let raf = 0;
    let last = performance.now();
    let rampStart = 0; // when the current run of motion began (speed ramp).
    let wasScrolling = false;
    let velocity = 0; // px/s carried from the last drag move (fling inertia)
    let momentum = false; // true while gliding after a flick release
    let lastMoveT = 0; // timestamp of the last pointermove (for velocity)
    const MOMENTUM_FRICTION = 4.2; // exponential decay rate; higher = stops sooner
    const MOMENTUM_MIN_V = 8; // px/s below which the glide ends
    const MOMENTUM_START_V = 40; // need at least this much flick to glide at all
    const startT = setTimeout(() => {
      startedRef.current = true;
    }, START_DELAY_MS);

    const maxScroll = () =>
      Math.max(0, content.offsetHeight - viewport.clientHeight);

    const apply = (p: number) => {
      posRef.current = p;
      content.style.transform = `translate3d(0, ${-p}px, 0)`;
    };

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const max = maxScroll();
      if (posRef.current > max) apply(max); // content re-measured shorter

      if (holdingRef.current) {
        // Dragging — pointermove drives the position; cancel any glide.
        momentum = false;
        wasScrolling = false;
      } else if (momentum) {
        // Fling inertia: keep gliding with exponential friction so a flick
        // flows on like a normal page. Runs even during the idle-resume window.
        let p = posRef.current + velocity * dt;
        velocity *= Math.exp(-MOMENTUM_FRICTION * dt);
        if (p <= 0) {
          p = 0;
          velocity = 0;
        } else if (p >= max) {
          p = max;
          velocity = 0;
        }
        if (Math.abs(velocity) < MOMENTUM_MIN_V) {
          velocity = 0;
          momentum = false;
        }
        apply(p);
        wasScrolling = false;
      } else {
        // Calm auto-scroll crawl when idle and not paused.
        const canScroll =
          startedRef.current &&
          !interactingRef.current &&
          !lightboxRef.current &&
          posRef.current < max - 0.5;
        if (canScroll) {
          // Ease speed up from 0 each time motion restarts — gentle, not a lurch.
          if (!wasScrolling) {
            rampStart = now;
            wasScrolling = true;
          }
          const t = Math.min((now - rampStart) / SCROLL_RAMP_MS, 1);
          const speed = AUTO_SCROLL_PXPS * t * t; // t² = accelerate from rest
          apply(Math.min(max, posRef.current + speed * dt));
        } else {
          wasScrolling = false; // paused → next resume ramps up again
        }
      }

      // Scroll-progress indicator: fill fraction = how far down we are.
      // Driven straight into the DOM (scaleX) so it stays perfectly in sync
      // with the crawl without a React re-render every frame.
      if (progressRef.current) {
        const frac = max <= 0 ? 1 : Math.min(1, Math.max(0, posRef.current / max));
        progressRef.current.style.transform = `scaleX(${frac})`;
      }

      const end = max <= 2 || posRef.current >= max - 2;
      setAtEnd((prev) => (prev === end ? prev : end));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Manual input. Holding (pointer down) hard-pauses the auto-scroll and lets
    // the reader drag; releasing settles then resumes. Wheel nudges the offset.
    let dragStartY = 0;
    let dragStartPos = 0;

    const onPointerDown = (e: PointerEvent) => {
      holdingRef.current = true;
      momentum = false; // grabbing kills any ongoing glide
      velocity = 0;
      setInteracting(true);
      interactingRef.current = true;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      dragStartY = e.clientY;
      dragStartPos = posRef.current;
      lastMoveT = performance.now();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!holdingRef.current) return;
      const now = performance.now();
      const newPos = Math.max(
        0,
        Math.min(maxScroll(), dragStartPos - (e.clientY - dragStartY)),
      );
      const dtM = (now - lastMoveT) / 1000;
      if (dtM > 0.001) {
        // Track release velocity with light smoothing (so one noisy sample
        // doesn't dominate) and a clamp (so a hard flick can't rocket off).
        const instant = (newPos - posRef.current) / dtM;
        velocity = Math.max(
          -9000,
          Math.min(9000, 0.7 * instant + 0.3 * velocity),
        );
      }
      lastMoveT = now;
      apply(newPos);
    };
    const onPointerUp = () => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      // A quick flick glides on; a slow/settled drag just stops.
      momentum = Math.abs(velocity) > MOMENTUM_START_V;
      markInteract(); // settle, then ease back into the auto crawl
    };
    const onWheel = (e: WheelEvent) => {
      momentum = false;
      apply(Math.max(0, Math.min(maxScroll(), posRef.current + e.deltaY)));
      markInteract();
    };

    viewport.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", markInteract);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(startT);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      viewport.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", markInteract);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // `post` is a dep so the loop/listeners are (re)attached once the article
    // renders. On prod the server fetch can fail (post null on mount → the
    // scroll DOM isn't there yet); when the client fetch fills `post` in, this
    // re-runs and wires up scrolling. Without it, prod pages don't scroll.
  }, [markInteract, post]);

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
    const content = contentRef.current;
    if (!content) return;
    // Freeze the auto-scroll and glide back to the top with a CSS transition
    // (the loop won't overwrite the transform while held), then resume.
    holdingRef.current = true;
    setInteracting(true);
    interactingRef.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    content.style.transition = "transform 500ms ease";
    content.style.transform = "translate3d(0, 0, 0)";
    posRef.current = 0;
    window.setTimeout(() => {
      content.style.transition = "";
      holdingRef.current = false;
      markInteract();
    }, 520);
  }, [markInteract]);

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
              Dinas Komunikasi & Informatika
            </p>
          </div>
        </div>
      </header>

      {/* ---- Scroll-progress indicator ----
           Fills left→right as the article scrolls; full when the reader has
           reached the bottom. The fill width is driven imperatively from the
           auto-scroll loop (see progressRef) so it tracks the crawl exactly. */}
      <div
        className="z-20 h-0.5 w-full shrink-0 bg-kendari-deep/10 lg:h-1"
        role="progressbar"
        aria-label="Posisi baca artikel"
      >
        <div
          ref={progressRef}
          className="h-full origin-left"
          style={{
            transform: "scaleX(0)",
            backgroundColor: "#3C82F6", // same accent blue as the slides bar
            boxShadow: "0 0 8px #3C82F6",
          }}
        />
      </div>

      {/* ---- Scrollable article ----
           The scroll box is absolutely sized inside this wrapper so the
           end-of-article overlay never changes its height (which would make
           "at end" flip on/off and flicker the countdown). */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-hidden"
          style={{ touchAction: "none" }}
        >
        <div ref={contentRef} className="will-change-transform">
        {/* Hero — tap to enlarge */}
        <button
          type="button"
          onClick={() => {
            // Enlarge the full-size original (uncropped), falling back to the
            // resized hero image if no original is available.
            const full = post.imageFullUrl ?? post.imageUrl;
            if (full) {
              setLightboxClosing(false);
              setLightboxSrc(full);
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
                  {nextId == null ? "Kembali ke beranda" : "Berita selanjutnya"}
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
              {nextId == null ? "Ke beranda" : "Lihat sekarang"}
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
