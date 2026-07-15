import type * as React from "react";
import { cn } from "@/shared/lib/utils";

/** Border-spin loader; sized via `size-*` classes (defaults to size-4). */
export function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Yükleniyor"
      className={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      {...props}
    />
  );
}
