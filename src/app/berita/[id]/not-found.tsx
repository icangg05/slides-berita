import { BeritaMissing } from "@/components/BeritaMissing";

/** Boundary for truly unmatched routes under /berita — reuses the bounce UI. */
export default function BeritaNotFound() {
  return <BeritaMissing />;
}
