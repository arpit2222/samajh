"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils.js";

export const JOURNEY_STEPS = [
  { id: 1, key: "capture", label: "Capture" },
  { id: 2, key: "concept", label: "Concept" },
  { id: 3, key: "teachback", label: "Teach-Back" },
  { id: 4, key: "score", label: "Score" },
  { id: 5, key: "stresstest", label: "Stress Test" },
  { id: 6, key: "result", label: "Result" },
];

export function ProgressStepper({ currentStep = 1, totalSteps = 6, className }) {
  const visibleSteps = totalSteps === 4 ? JOURNEY_STEPS.slice(0, 4) : JOURNEY_STEPS;
  return (
    <nav aria-label="Samajh Verification Journey" className={cn("mb-6", className)}>
      <ol
        className={cn(
          "grid gap-2",
          totalSteps === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3 sm:grid-cols-6"
        )}
      >
        {visibleSteps.map((item) => {
          const isActive = currentStep === item.id;
          const isDone = currentStep > item.id;

          return (
            <li
              key={item.key}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "rounded-xl border px-3 py-2.5 flex items-center gap-2.5 transition-all duration-200",
                isActive
                  ? "border-brand-600 dark:border-brand-500 bg-brand-50/90 dark:bg-brand-500/15 shadow-sm shadow-brand-500/10"
                  : isDone
                    ? "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/10"
                    : "border-border bg-card/80"
              )}
            >
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors",
                  isActive
                    ? "bg-brand-600 text-white"
                    : isDone
                      ? "bg-emerald-600 dark:bg-emerald-500 text-white dark:text-slate-950"
                      : "bg-secondary text-muted-foreground"
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : item.id}
              </div>
              <span
                className={cn(
                  "text-xs font-semibold truncate",
                  isActive ? "text-brand-800 dark:text-brand-200" : "text-foreground"
                )}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
