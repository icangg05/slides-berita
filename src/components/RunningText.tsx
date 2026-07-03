"use client";

/**
 * Seamless marquee ticker. The list is rendered twice back-to-back and the
 * track translates by -50%, so the loop is gapless. Speed is set by the
 * `--animate-marquee` duration in globals.css. Freezes when `paused` (e.g.
 * while a visitor is touching the screen).
 */
export function RunningText({
  items,
  paused = false,
}: {
  items: string[];
  paused?: boolean;
}) {
  const list = items.length ? items : ["Memuat berita terkini Kota Kendari…"];

  return (
    <div className="edge-fade-x relative flex-1 overflow-hidden py-2 lg:py-3">
      <div
        className="flex w-max animate-marquee whitespace-nowrap will-change-transform"
        style={{ animationPlayState: paused ? "paused" : "running" }}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex" aria-hidden={copy === 1}>
            {list.map((text, i) => (
              <span
                key={`${copy}-${i}`}
                className="mx-5 inline-flex items-center text-sm font-medium text-blue-50 sm:mx-6 sm:text-base lg:mx-8 lg:text-xl"
              >
                <span className="mr-2 text-kendari-sky lg:mr-3">◆</span>
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
