"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "./Logo";
import { Button } from "./ui/button";

/**
 * Graceful "article unavailable" screen (e.g. a slide's article was removed
 * upstream). Auto-returns to the slideshow so the kiosk never dead-ends.
 */
export function BeritaMissing() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.push("/"), 6000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="kiosk-surface flex h-[100dvh] flex-col items-center justify-center gap-5 bg-gradient-to-b from-kendari-deep to-kendari-deepblue px-8 text-center lg:gap-6 lg:px-10">
      <div className="h-20 w-16 opacity-90 lg:h-24 lg:w-20">
        <Logo className="h-full w-full" />
      </div>
      <h1 className="font-heading text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
        Berita tidak ditemukan
      </h1>
      <p className="max-w-lg text-base text-blue-100/70 sm:text-lg lg:text-xl">
        Artikel ini mungkin telah dipindahkan. Sistem akan kembali ke slideshow
        secara otomatis.
      </p>
      <Button
        onClick={() => router.push("/")}
        size="xl"
        className="mt-2 rounded-full font-heading"
      >
        Kembali ke Berita
      </Button>
    </main>
  );
}
