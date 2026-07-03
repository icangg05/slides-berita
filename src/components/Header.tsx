import { Logo } from "./Logo";
import { LiveClock } from "./LiveClock";
import { RunningText } from "./RunningText";
import { Badge } from "./ui/badge";

/**
 * Kiosk header (PRD F-04 + layout): official Kendari emblem + Diskominfo
 * attribution, a live WITA clock, and a running-text ticker of headlines.
 * Fully responsive — scales down cleanly on a phone, up to the 1080px panel.
 */
export function Header({
  headlines,
  paused = false,
}: {
  headlines: string[];
  paused?: boolean;
}) {
  return (
    <header className="relative z-20 shrink-0">
      <div className="flex items-center justify-between gap-3 bg-kendari-deepblue px-4 pt-4 pb-3 sm:px-6 lg:gap-6 lg:px-10 lg:pt-8 lg:pb-6">
        {/* Institutional identity */}
        <div className="flex min-w-0 items-center gap-3 lg:gap-5">
          <div className="size-11 shrink-0 sm:size-14 lg:size-[72px]">
            <Logo className="h-full w-full" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="font-heading text-base font-extrabold tracking-tight text-white sm:text-xl lg:text-3xl">
              Kota Kendari
            </p>
            <p className="mt-0.5 line-clamp-2 max-w-[15rem] text-[0.72rem] font-medium text-blue-100/85 sm:max-w-sm sm:text-sm lg:mt-1 lg:max-w-md lg:text-lg">
              Dinas Komunikasi dan Informatika
            </p>
          </div>
        </div>

        {/* Live clock */}
        <LiveClock />
      </div>

      {/* Running text ticker */}
      <div className="flex items-stretch bg-kendari-deep shadow-lg">
        <Badge
          variant="default"
          className="flex shrink-0 items-center gap-1.5 rounded-none px-3 font-heading text-xs font-bold uppercase tracking-wide sm:gap-2 sm:px-6 lg:text-lg">
          <span className="size-2 animate-soft-pulse rounded-full bg-white sm:size-2.5" />
          Berita Terkini
        </Badge>
        <RunningText items={headlines} paused={paused} />
      </div>
    </header>
  );
}
