import React from "react";
import { cn } from "../../lib/utils.js";

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-[0_8px_30px_rgb(15,23,42,0.06)] dark:shadow-[0_18px_50px_rgb(0,0,0,0.45)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-2 p-6 sm:p-8 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return (
    <h2
      className={cn("text-2xl sm:text-[28px] font-extrabold tracking-tight leading-tight text-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }) {
  return (
    <p className={cn("text-sm sm:text-[15px] text-muted-foreground leading-relaxed", className)} {...props} />
  );
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-6 sm:p-8 pt-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-6 sm:px-8 py-5 border-t border-border/80 bg-muted/35 rounded-b-2xl",
        className
      )}
      {...props}
    />
  );
}
