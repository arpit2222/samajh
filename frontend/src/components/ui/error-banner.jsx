import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./button.jsx";
import { cn } from "../../lib/utils.js";

export function ErrorBanner({ message, onRetry, retryLabel = "Try Again", action, className }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-rose-200 dark:border-rose-500/35 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-200 flex items-start justify-between gap-3 flex-wrap",
        className
      )}
    >
      <div className="flex items-start gap-2.5 flex-1 min-w-[200px]">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
        <div className="space-y-1">
          <p className="font-semibold leading-snug">{message}</p>
          {action}
        </div>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5" /> {retryLabel}
        </Button>
      )}
    </div>
  );
}
