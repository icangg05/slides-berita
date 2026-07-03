import Image from "next/image";

/** Official Kendari city emblem (Lambang Kota Kendari). */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Image
        src="/Lambang_Kota_Kendari.webp"
        alt="Lambang Kota Kendari"
        fill
        sizes="120px"
        className="object-contain drop-shadow-md"
        priority
      />
    </div>
  );
}
