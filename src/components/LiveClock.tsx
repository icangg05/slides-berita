"use client";

import { useEffect, useState } from "react";

/** Live digital clock, always in WITA (Asia/Makassar) per the PRD. */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Makassar",
      }).format(now)
    : "--:--:--";

  const day = now
    ? new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Asia/Makassar",
      }).format(now)
    : "";

  return (
    <div className="flex shrink-0 flex-col items-end leading-none">
      <div className="flex items-baseline gap-1.5 lg:gap-2">
        <span
          className="font-heading text-2xl font-extrabold tabular-nums tracking-tight text-white sm:text-3xl lg:text-5xl"
          suppressHydrationWarning
        >
          {time}
        </span>
        <span className="text-xs font-semibold text-kendari-sky lg:text-lg">
          WITA
        </span>
      </div>
      <span
        className="mt-0.5 text-[0.7rem] font-medium text-blue-100/80 lg:mt-1 lg:text-base"
        suppressHydrationWarning
      >
        {day}
      </span>
    </div>
  );
}
