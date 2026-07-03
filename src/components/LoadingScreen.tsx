import { Logo } from "./Logo";

/** Shared loading UI — a circular spinner around the Kendari emblem. */
export function LoadingScreen({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-6 bg-kendari-slate ${className}`}
    >
      <div className="relative grid size-28 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-kendari-deep/15 border-t-kendari-accent" />
        <div className="size-16">
          <Logo className="h-full w-full" />
        </div>
      </div>
      <p className="font-heading text-2xl font-bold text-kendari-deep">
        Memuat berita…
      </p>
    </div>
  );
}
