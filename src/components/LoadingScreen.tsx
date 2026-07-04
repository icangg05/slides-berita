"use client";

import { useLayoutEffect, useRef } from "react";
import { Logo } from "./Logo";

const SPIN_MS = 1000; // matches Tailwind's `animate-spin` (spin 1s linear).

/** Shared loading UI — a circular spinner around the Kendari emblem. */
export function LoadingScreen({ className = "" }: { className?: string }) {
  const spinRef = useRef<HTMLSpanElement>(null);

  // Phase-sync the ring to the wall clock. A single page transition mounts
  // several LoadingScreens back-to-back (kiosk tap veil → route loading.tsx →
  // detail mount veil); each fresh `animate-spin` would otherwise restart at
  // 0°, making the ring visibly snap back and look like it "spins twice".
  // A negative animation-delay tied to Date.now() makes every instance sit at
  // the same angle at any moment, so the rotation looks continuous across the
  // hand-off. Applied in a layout effect (before paint) and imperatively — so
  // it never appears in the server HTML and can't cause a hydration mismatch.
  useLayoutEffect(() => {
    if (spinRef.current) {
      spinRef.current.style.animationDelay = `-${Date.now() % SPIN_MS}ms`;
    }
  }, []);

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-6 bg-gradient-to-b from-kendari-deep to-kendari-deepblue text-white ${className}`}
    >
      <div className="relative grid size-28 place-items-center">
        <span
          ref={spinRef}
          className="absolute inset-0 animate-spin rounded-full border-4 border-white/15 border-t-kendari-sky"
        />
        <div className="size-16">
          <Logo className="h-full w-full" />
        </div>
      </div>
      <p className="font-heading text-2xl font-bold text-blue-100/90">
        Memuat berita…
      </p>
    </div>
  );
}
