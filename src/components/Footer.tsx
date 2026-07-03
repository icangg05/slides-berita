/**
 * Institutional footer (PRD F-04). The exact accountability statement is
 * mandated by the PRD and must be shown verbatim.
 */
export function Footer() {
  return (
    <footer className="shrink-0 border-t border-white/10 bg-kendari-deepblue/95 px-5 py-3 text-center backdrop-blur-sm lg:px-10 lg:py-4">
      <p className="mx-auto max-w-4xl text-[0.68rem] leading-relaxed text-blue-100/70 sm:text-xs lg:text-sm">
        Dikembangkan dan Dikelola oleh{" "}
        <span className="font-semibold text-blue-50">
          Dinas Kominfo Kota Kendari
        </span>{" "}
        sebagai Fasilitator Integrasi Data &amp; Pusat Informasi Publik Digital
        Kota Kendari
      </p>
    </footer>
  );
}
