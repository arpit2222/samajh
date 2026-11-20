import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

export function Spinner({ label, size = "md", className }) {
  const sizeClass =
    size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center justify-center gap-2.5 text-muted-foreground", className)}
    >
      <Loader2 className={cn("animate-spin text-brand-600 dark:text-brand-400 shrink-0", sizeClass)} />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );
}
