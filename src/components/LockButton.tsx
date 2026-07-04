"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, LockOpen } from "lucide-react";

const HOLD_MS = 1500; // hold 1.5 seconds to toggle the lock.

/**
 * Floating lockdown control (PRD F-03).
 *
 * The kiosk starts LOCKED. A staff member press-and-holds this button for
 * 1.5 s to toggle "Kunci" mode (a progress ring fills as feedback). When the
 * public taps the locked screen, `hintTick` is bumped and this icon shakes to
 * say "you have to hold this first".
 */
export function LockButton({
  locked,
  onToggle,
  hintTick = 0,
  visible = true,
}: {
  locked: boolean;
  onToggle: () => void;
  hintTick?: number;
  /** When locked, the button is hidden until a screen tap reveals it. */
  visible?: boolean;
}) {
  const [progress, setProgress] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const firedRef = useRef(false);

  // "Padlock released" burst: bumped when a hold actually UNLOCKS the screen,
  // so the moment is obvious even while a thumb covers the icon (the radiating
  // ring and the floating label appear AROUND / ABOVE the finger). Tied to the
  // hold action (not the `locked` prop) so restoring an unlocked state on load
  // never triggers a stray burst.
  const [unlockTick, setUnlockTick] = useState(0);
  // Mirror burst for LOCKING: rings converge inward + a "Layar terkunci" label.
  const [lockTick, setLockTick] = useState(0);

  const stopHold = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setProgress(0);
  }, []);

  const tick = useCallback(
    (now: number) => {
      const elapsed = now - startRef.current;
      const p = Math.min(elapsed / HOLD_MS, 1);
      setProgress(p);
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          // Currently locked → UNLOCKING (release burst); else → LOCKING burst.
          if (locked) setUnlockTick((t) => t + 1);
          else setLockTick((t) => t + 1);
          onToggle();
        }
        stopHold();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [locked, onToggle, stopHold],
  );

  const startHold = useCallback(() => {
    firedRef.current = false;
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => stopHold, [stopHold]);

  const R = 30;
  const C = 2 * Math.PI * R;

  // Consistent transparent "glass" look in every state (no solid fill).
  // Unlocked → faint, always shown (re-lock affordance).
  // Locked + revealed → same glass, fully shown, tappable.
  // Locked + hidden → faded out, not interactive.
  const stateClass = !locked
    ? "cursor-pointer bg-white/10 opacity-45 ring-1 ring-white/20 backdrop-blur-md hover:opacity-95 active:opacity-100"
    : visible
      ? "cursor-pointer bg-white/10 opacity-100 ring-1 ring-white/25 backdrop-blur-md"
      : "pointer-events-none scale-90 bg-white/10 opacity-0";

  return (
    <>
    <button
      type="button"
      data-lockbtn
      aria-label={
        locked
          ? "Buka kunci layar (tahan 1,5 detik)"
          : "Kunci layar (tahan 1,5 detik)"
      }
      onPointerDown={(e) => {
        e.preventDefault();
        startHold();
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(e) => e.preventDefault()}
      className={`group fixed bottom-4 right-4 z-50 grid size-16 place-items-center rounded-full transition-all duration-300 lg:bottom-6 lg:right-6 lg:size-20 ${stateClass}`}
      style={{ touchAction: "none" }}
    >
      {/* Hold-progress ring */}
      <svg
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox="0 0 80 80"
      >
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="4"
        />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{
            transition: progress === 0 ? "stroke-dashoffset 200ms" : "none",
          }}
        />
      </svg>

      {/* Glyph — remounts on hintTick (shake) or unlockTick (pop) to replay. */}
      <span
        key={`${hintTick}-${unlockTick}`}
        className={`grid place-items-center ${
          locked
            ? hintTick > 0
              ? "animate-lock-nudge"
              : ""
            : unlockTick > 0
              ? "animate-unlock-pop"
              : ""
        }`}
      >
        {locked ? (
          <Lock className="size-6 text-white lg:size-7" strokeWidth={2.5} />
        ) : (
          <LockOpen className="size-6 text-white lg:size-7" strokeWidth={2.5} />
        )}
      </span>
    </button>

    {/* Unlock burst — a SIBLING of the button (so the button's own fade to
        45% opacity doesn't dim it). Matches the button's fixed spot; rings
        radiate past a covering thumb and the label rises above it. */}
    {unlockTick > 0 && (
      <div
        key={unlockTick}
        aria-hidden
        className="pointer-events-none fixed bottom-4 right-4 z-[55] grid size-16 place-items-center lg:bottom-6 lg:right-6 lg:size-20"
      >
        <span className="animate-unlock-ring absolute inset-0 rounded-full border-2 border-white" />
        <span className="animate-unlock-ring absolute inset-0 rounded-full border-2 border-kendari-sky [animation-delay:130ms]" />
        <span className="animate-unlock-label absolute bottom-full right-0 mb-3 whitespace-nowrap rounded-full bg-kendari-deep/90 px-3 py-1 font-heading text-xs font-bold text-white ring-1 ring-white/25 backdrop-blur-md">
          Layar terbuka
        </span>
      </div>
    )}

    {/* Lock burst — rings converge inward (securing) + a "Layar terkunci"
        label. A sibling too, so it stays visible even as the button hides. */}
    {lockTick > 0 && (
      <div
        key={`lock-${lockTick}`}
        aria-hidden
        className="pointer-events-none fixed bottom-4 right-4 z-[55] grid size-16 place-items-center lg:bottom-6 lg:right-6 lg:size-20"
      >
        <span className="animate-lock-ring absolute inset-0 rounded-full border-2 border-white" />
        <span className="animate-lock-ring absolute inset-0 rounded-full border-2 border-kendari-sky [animation-delay:120ms]" />
        <span className="animate-unlock-label absolute bottom-full right-0 mb-3 whitespace-nowrap rounded-full bg-kendari-deep/90 px-3 py-1 font-heading text-xs font-bold text-white ring-1 ring-white/25 backdrop-blur-md">
          Layar terkunci
        </span>
      </div>
    )}
    </>
  );
}
