import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";

// Every timed game had hand-rolled its own `⏱ {n} sn` badge, so they drifted
// in shape and none of them reacted as time ran out. One component now, with
// the urgency built in: below `urgentAt` it turns red and starts pulsing, so
// "you are about to lose your turn" is felt rather than read.
//
// `tabular-nums` keeps the badge from resizing as the digits change — a
// countdown that jitters every second is worse than no countdown.

export function CountdownBadge({
  seconds,
  urgentAt = 5,
  className,
}: CountdownBadgeProps) {
  const urgent = seconds <= urgentAt && seconds > 0;
  return (
    <Badge
      variant="outline"
      aria-live={urgent ? "polite" : "off"}
      className={cn(
        "font-mono tabular-nums",
        urgent &&
          "animate-urgent border-destructive/60 bg-destructive/15 text-destructive",
        className,
      )}
    >
      ⏱ {seconds} sn
    </Badge>
  );
}

interface CountdownBadgeProps {
  seconds: number;
  /** Seconds remaining at which the badge starts pulsing red. */
  urgentAt?: number;
  className?: string;
}
