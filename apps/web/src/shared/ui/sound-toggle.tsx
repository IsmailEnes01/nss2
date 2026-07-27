import { Volume2, VolumeX } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  isSoundEnabled,
  playClick,
  setSoundEnabled,
  soundServerSnapshot,
  subscribeSound,
} from "@/shared/lib/sound";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

// Mounted once, globally, from the root route — the home page has no header
// chrome to hang it off, and it needs to be reachable mid-match too. Pinned
// bottom-RIGHT because the chat panel already owns bottom-left.
//
// `useSyncExternalStore` rather than useState + an effect: the preference
// lives outside React (it's read by plain `playClick` calls), and this is the
// hook that keeps an external store and SSR honest at once — the server
// renders `soundServerSnapshot()` and React re-reads the real localStorage
// value after hydration without a mismatch warning.

export function SoundToggle({ className }: { className?: string }) {
  const enabled = useSyncExternalStore(
    subscribeSound,
    isSoundEnabled,
    soundServerSnapshot,
  );

  function toggle(): void {
    const next = !enabled;
    setSoundEnabled(next);
    // Turning sound ON should be audible — but Button's own click already
    // fired while sound was still off, so nothing was heard. Play one here so
    // the toggle confirms itself. (Turning OFF needs no such help: Button's
    // click got through as the last sound before the mute took effect.)
    if (next) playClick();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Sesi kapat" : "Sesi aç"}
      title={enabled ? "Sesi kapat" : "Sesi aç"}
      className={cn(
        "fixed right-4 bottom-4 z-40 size-9 rounded-full shadow-lg",
        !enabled && "text-muted-foreground",
        className,
      )}
    >
      {enabled ? (
        <Volume2 aria-hidden="true" />
      ) : (
        <VolumeX aria-hidden="true" />
      )}
    </Button>
  );
}
