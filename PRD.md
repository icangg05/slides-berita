# PRODUCT REQUIREMENT DOCUMENT (PRD)

## 1. Ringkasan Proyek (Project Overview)
* **Nama Proyek:** Kendari News Kiosk Digital Signage App
* **Deskripsi:** Sebuah aplikasi web berbasis Next.js yang dirancang khusus untuk perangkat *Digital Signage Kiosk* (Microvision) berbentuk vertikal (*portrait*). Aplikasi ini akan menampilkan slideshow berita terkini dari Kota Kendari secara otomatis dan interaktif guna menyambut kunjungan dinas dan menyajikan informasi publik di area lobi/command center.
* **Target Pengguna:** Pengunjung kantor Kominfo, tamu dinas luar daerah (Diskominfo Bontang), dan masyarakat umum.
* **Jadwal Rilis:** Senin Terdekat (*Pre-visit Preview ready*).

---

## 2. Tech Stack & Spesifikasi Teknis
* **Framework:** Next.js (Versi terbaru, menggunakan App Router).
* **Styling & UI:** Tailwind CSS v4.3.
* **Sumber Data (Data Source):** WordPress REST API dari `https://berita.kendarikota.go.id`.
* **Tipografi (Fonts):** * **Sen:** Digunakan untuk elemen Heading/Judul agar berkarakter tegas dan modern.
  * **DM Sans:** Digunakan untuk Body Text/Deskripsi agar keterbacaannya tinggi pada layar besar.
* **Target Resolusi:** Dioptimalkan untuk aspek rasio vertikal (*Portrait Mode*, umumnya 1080x1920 piksel).

---

## 3. Spesifikasi Arsitektur Docker (Containerization)
Proyek ini wajib dibangun di atas infrastruktur Docker terisolasi yang dipisah menjadi dua lingkungan (*environment*):

### 3.1 Lingkungan Pengembangan (Development Environment)
* **Karakteristik Utama:** Mendukung **Hot Reload / Live Reload** agar setiap perubahan kode di komputer lokal langsung mencerminkan perubahan di layar tanpa perlu melakukan *build* ulang atau *restart* kontainer.
* **Konfigurasi Container:**
  * Menggunakan base image `node:18-alpine` atau versi di atasnya yang stabil.
  * Menjalankan perintah `npm run dev` atau `yarn dev`.
  * Memanfaatkan **Docker Volumes** untuk memetakan direktori lokal (`./`) ke dalam direktori kerja kontainer (`/app`), sehingga perubahan berkode (termasuk Tailwind kompilasi) langsung terdeteksi.

### 3.2 Lingkungan Produksi (Production Environment)
* **Karakteristik Utama:** Dioptimalkan untuk kecepatan (*performance*), keamanan, dan ukuran *image* yang sekecil mungkin (*lightweight*).
* **Konfigurasi Container:**
  * Menggunakan metode **Multi-stage Build** untuk memisahkan proses kompilasi kode dan proses *runtime*.
  * **Stage 1 (Builder):** Melakukan instalasi dependencies lengkap dan menjalankan perintah `npm run build` untuk menghasilkan *output static/optimized assets*.
  * **Stage 2 (Runner):** Hanya menyalin hasil kompilasi dari Stage 1 dan berkas esensial Next.js (`.next/standalone` dan `.next/static`), lalu menjalankannya dengan mode produksi `node server.js`.

---

## 4. Fitur Utama & Kebutuhan Fungsional (Functional Requirements)

### F-01: Auto-Play Slideshow Berita
* Sistem harus memuat **20 data berita terbaru** dari API WordPress.
* Berita ditampilkan dalam bentuk slider/slideshow satu per satu secara otomatis.
* Interval waktu perpindahan antar *slide* dikunci secara *default* per **8–10 detik**.
* Transisi antar berita harus halus (efek *fade* atau *slide* yang elegan memakai fitur animasi Tailwind).

### F-02: Mode Interaktif (Halaman Detail Berita)
* Setiap berita pada slideshow dapat diklik/disentuh oleh pengunjung.
* Ketika diklik, slideshow akan berhenti sementara (*pause*) dan sistem akan mengarahkan pengguna ke halaman **Detail Berita** (berisi judul lengkap, gambar resolusi penuh, tanggal, dan isi konten berita).
* Halaman Detail wajib menyediakan tombol **"Kembali ke Berita"** yang jika didiamkan selama 1 menit tanpa aktivitas (*idle*), sistem otomatis kembali ke mode slideshow utama.

### F-03: Kunci Layar (Lockdown Mode / Floating Button)
* Menyediakan sebuah **Floating Button (Tombol Melayang)** tersembunyi atau tersamar yang hanya diketahui oleh admin/staf Kominfo.
* **Fungsi:** Ketika tombol ini diaktifkan (memerlukan interaksi khusus seperti *hold* 3 detik atau klik ikon gembok), layar akan masuk ke mode **"Kunci"**.
* Saat mode "Kunci" aktif, seluruh interaksi sentuhan pada slideshow berita akan diblokir total (seakan-akan layar non-touchscreen) agar slideshow berjalan mulus tanpa gangguan tangan iseng. Klik kembali tombol melayang tersebut untuk membuka kunci.

### F-04: Atribusi Kelembagaan (Header & Footer)
Sistem wajib mencantumkan identitas resmi pengembang secara jelas pada antarmuka aplikasi sebagai bentuk akuntabilitas publik dan penegasan aset daerah:
* **Pada Bagian Header:** Menampilkan Logo Resmi Kota Kendari berdampingan dengan Teks **"Dinas Komunikasi dan Informatika Kota Kendari"**.
* **Pada Bagian Footer:** Menampilkan teks penjelas peran kelembagaan yang tegas, yaitu:
  > **"Dikembangkan dan Dikelola oleh Dinas Kominfo Kota Kendari sebagai Fasilitator Integrasi Data & Pusat Informasi Publik Digital Kota Kendari"**

---

## 5. Panduan Desain & UI/UX (Design Guidelines)

### Konsep Tema
Modern, Profesional, Bersih, dan Berwibawa dengan sentuhan estetika **Glassmorphism** (efek kaca transparan) pada panel informasi di atas latar foto berita.

### Palet Warna (Referensi dari `kendarikota.go.id`)
Mengadopsi skema warna resmi Pemerintah Kota Kendari yang kokoh dan tepercaya:
* **Primary Deep Blue:** `#0b3c5d` / `#1e3a8a` (Warna biru tua dominan pada komponen navigasi, latar gradasi bawah, dan tombol).
* **Accent Vibrant Blue:** `#3b82f6` (Biru terang untuk *badge* kategori atau elemen aktif).
* **Background Base:** `#f8fafc` (Slate terang untuk teks detail) atau `#020617` (Slate gelap/Hitam pekat sebagai dasar penahan kontras gambar latar belakang).
* **Glass Panel:** `rgba(255, 255, 255, 0.1)` dengan `backdrop-blur-md` untuk penulisan teks ringkasan berita di atas gambar.

### Struktur Tata Letak (Layouting Portrait)
* **Bagian Atas (Header):** Logo Pemerintah Kota Kendari, Atribusi Dinas Kominfo, Jam Live digital (WITA), dan Running Text indikator berita terkini.
* **Bagian Tengah (Hero Media):** Gambar utama berita (*Featured Image*) berukuran besar yang memenuhi batas atas ke bawah.
* **Bagian Bawah (Content Card & Footer):** Kotak teks transparan (*glassmorphism*) yang memuat judul berita dengan ukuran font besar (Sen Font), cuplikan paragraf awal (DM Sans), dan teks keterangan peran operasional Dinas Kominfo Kendari di baris paling bawah.

---

## 6. Integrasi API WordPress
Aplikasi akan melakukan *fetching* data secara berkala (misal setiap 5-10 menit sekali) ke endpoint berikut untuk mendeteksi berita *live* terbaru:
* **Daftar 20 Berita Terbaru:**
  ```text
  GET [https://berita.kendarikota.go.id/wp-json/wp/v2/posts?per_page=20&_embed](https://berita.kendarikota.go.id/wp-json/wp/v2/posts?per_page=20&_embed)