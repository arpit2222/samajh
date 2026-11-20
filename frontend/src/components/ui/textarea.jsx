import React from "react";
import { cn } from "../../lib/utils.js";

export const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[140px] w-full rounded-xl border border-input bg-card px-4 py-3.5 text-sm sm:text-[15px] text-foreground leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 resize-y transition-all shadow-inner shadow-slate-900/[0.02]",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";
