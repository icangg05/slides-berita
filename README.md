# Kendari News Kiosk — Digital Signage App

Aplikasi web **Next.js** untuk perangkat *Digital Signage Kiosk* (Microvision)
berorientasi **portrait (1080×1920)**. Menampilkan slideshow otomatis 20 berita
terbaru Kota Kendari dari WordPress REST API, lengkap dengan mode interaktif,
mode kunci layar, dan atribusi resmi Dinas Kominfo Kota Kendari.

> Dikembangkan dan Dikelola oleh **Dinas Kominfo Kota Kendari** sebagai
> Fasilitator Integrasi Data & Pusat Informasi Publik Digital Kota Kendari.

---

## Tech stack

| Area        | Pilihan                                                        |
| ----------- | ------------------------------------------------------------- |
| Framework   | Next.js (App Router) + React 19                               |
| Styling     | Tailwind CSS v4 (glassmorphism, animasi)                      |
| Fonts       | **Sen** (heading) + **DM Sans** (body) via `next/font`        |
| Data source | WordPress REST API `berita.kendarikota.go.id`                 |
| Container   | Docker — dev (hot reload) & prod (multi-stage standalone)     |

---

## Menjalankan

### A. Lokal (tanpa Docker)

```bash
npm install
npm run dev          # http://localhost:3000
```

Produksi lokal:

```bash
npm run build
npm start
```

### B. Docker — Development (hot reload, PRD §3.1)

```bash
docker compose -f docker-compose.dev.yml up --build
# http://localhost:3003  — edit kode di host, layar langsung ter-reload
```

> Menambah dependency baru? Container dev otomatis `npm install` saat start
> (lihat `Dockerfile.dev`), jadi cukup `up` ulang. Kalau masih ter-cache:
> `docker compose -f docker-compose.dev.yml up --build --renew-anon-volumes`.

### C. Docker — Production (PRD §3.2)

```bash
docker compose up --build -d
# http://localhost:3003  — image ramping (multi-stage, node server.js)
```

> Produksi memanggang dependency ke dalam image, jadi setiap ada perubahan
> dependency WAJIB pakai `--build`.

---

## Peta fitur ↔ PRD

| PRD    | Fitur                          | Implementasi                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------- |
| F-01   | Auto-play slideshow            | [`Kiosk.tsx`](src/components/Kiosk.tsx) — 20 berita, ~9 dtk/slide, crossfade + Ken Burns |
| F-02   | Mode interaktif (detail)       | [`berita/[id]`](src/app/berita/[id]/page.tsx) + [`DetailView.tsx`](src/components/DetailView.tsx) — idle 60 dtk auto-kembali |
| F-03   | Kunci layar (floating button)  | [`LockButton.tsx`](src/components/LockButton.tsx) — **tahan 3 detik** untuk kunci/buka |
| F-04   | Atribusi kelembagaan           | [`Header.tsx`](src/components/Header.tsx) + [`Footer.tsx`](src/components/Footer.tsx) |
| §5     | Glassmorphism + palet Kendari  | [`globals.css`](src/app/globals.css) (design tokens `@theme`)       |
| §6     | Refresh berkala 5–10 mnt       | ISR `revalidate` + polling klien via [`/api/posts`](src/app/api/posts/route.ts) |

### Cara pakai mode Kunci (F-03)

Tombol gembok samar ada di **pojok kanan bawah** (transparan saat idle).
**Tekan & tahan 3 detik** hingga cincin progres penuh untuk mengunci layar —
seluruh sentuhan pada slideshow diblokir (seolah non-touchscreen), slideshow
tetap berjalan. Tahan 3 detik lagi untuk membuka kunci.

---

## Mengganti logo resmi

Emblem saat ini adalah **placeholder SVG** ([`Logo.tsx`](src/components/Logo.tsx))
karena aset resmi situs terproteksi hotlink. Untuk memakai logo asli:

1. Simpan berkas ke `public/logo-kendari.png`.
2. Di `src/components/Logo.tsx`, ganti isi `<svg>` dengan:
   ```tsx
   import Image from "next/image";
   export function Logo({ className = "" }: { className?: string }) {
     return (
       <div className={className}>
         <Image src="/logo-kendari.png" alt="Logo Kota Kendari"
                fill className="object-contain" />
       </div>
     );
   }
   ```

---

## Konfigurasi

| Env var       | Default                                              | Fungsi                        |
| ------------- | ---------------------------------------------------- | ----------------------------- |
| `WP_API_BASE` | `https://berita.kendarikota.go.id/wp-json/wp/v2`     | Endpoint WordPress REST       |
| `PORT`        | `3000`                                               | Port server (prod standalone) |

Konstanta perilaku ada di [`src/lib/wp.ts`](src/lib/wp.ts) (`NEWS_COUNT`,
`REVALIDATE_SECONDS`) dan [`Kiosk.tsx`](src/components/Kiosk.tsx) (`SLIDE_MS`,
`POLL_MS`).

---

## Catatan kiosk (portrait)

- Arahkan browser kiosk (mode fullscreen/portrait) ke `http://<host>:3003`.
- Rasio desain dikunci ke lebar maks **1080px** dan tinggi `100dvh`.
- Kursor disembunyikan & seleksi teks dimatikan pada layar slideshow.
