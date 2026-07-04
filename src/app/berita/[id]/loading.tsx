import { LoadingScreen } from "@/components/LoadingScreen";

/** Route-level loading. Renders SOLID (no fade-in): the tap that navigates
 * here already faded a loading veil in over the kiosk, and the detail view's
 * own mount veil continues it — a second fade-in here made the loader look
 * like it replayed. Staying solid keeps the whole hand-off one seamless screen. */
export default function LoadingDetail() {
  return (
    <div className="h-[100dvh]">
      <LoadingScreen />
    </div>
  );
}
