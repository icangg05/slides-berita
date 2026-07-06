import Image from "next/image";
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
        {/* Institutional identity — official Kendari web banner + Diskominfo. */}
        <div className="flex min-w-0 flex-col gap-0">
          <Image
            src="/logo-berita-kdi.webp"
            alt="Kendari Kota — Website Resmi Pemerintah Daerah Kota Kendari"
            width={716}
            height={100}
            priority
            className="h-7 w-auto max-w-full sm:h-9 lg:h-12"
          />
          {/* Indent so the subtitle lines up under the "kendarikota" wordmark
              (the emblem occupies the left ~17% of the logo), not the emblem. */}
          <p className="line-clamp-2 max-w-[15rem] pl-[5px] text-[0.72rem] font-medium text-blue-100/85 sm:max-w-sm sm:pl-[43px] sm:text-sm lg:max-w-md lg:pl-[58px] lg:text-lg">
            Dinas Komunikasi & Informatika
          </p>
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
