import { BeritaMissing } from "@/components/BeritaMissing";

/** Global fallback — any unmatched route bounces back to the slideshow. */
export default function NotFound() {
  return <BeritaMissing />;
}
