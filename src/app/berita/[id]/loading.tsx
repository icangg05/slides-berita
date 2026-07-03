import { LoadingScreen } from "@/components/LoadingScreen";

/** Route-level loading — eases in while the article is fetched. */
export default function LoadingDetail() {
  return (
    <div className="animate-fade-in h-[100dvh]">
      <LoadingScreen />
    </div>
  );
}
