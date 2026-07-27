import type * as React from "react";
import { cn } from "@/shared/lib/utils";

// The surface game boards group things onto. Boards had each redeclared their
// own `rounded-2xl border bg-card p-3` wrapper, which meant the shape and
// elevation language drifted per game; this is the one definition.
//
// Distinct from `Card`: `Card` is the app's chrome (lobby panels, the home
// grid, the chat window) with its own header/footer slots and elevation.
// `Panel` is a plainer inner surface used *inside* a board, so a board can
// group content without nesting a full Card in whatever the shell already
// rendered.

export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3",
        // Panels are what swap when a phase changes, so a soft entrance here
        // covers most of the app's transitions for free. Deliberately subtle:
        // this fires on every phase change of every round, so anything showier
        // would wear out fast.
        "animate-in fade-in slide-in-from-bottom-2 duration-300",
        className,
      )}
      {...props}
    />
  );
}

/** Section heading inside a Panel — display face, matching CardTitle's
 * treatment one size down. */
export function PanelTitle({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="panel-title"
      className={cn("font-display text-sm font-semibold", className)}
      {...props}
    />
  );
}
