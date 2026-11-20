"use client";

import React, { useState } from "react";
import { Calculator, ChevronDown, ChevronUp, Terminal, CheckCircle2 } from "lucide-react";
import { Badge } from "./ui/badge.jsx";

export default function MathVerificationCard({ math, title = "Computed Financial Math Check" }) {
  const [showCode, setShowCode] = useState(false);

  if (!math?.summary) return null;

  const isAdkPython = math.engine === "adk-built-in-code-executor";

  return (
    <div className="rounded-2xl border border-indigo-200 dark:border-indigo-500/35 bg-indigo-50/60 dark:bg-indigo-500/10 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
          <Calculator className="h-4 w-4" /> {title}
        </div>
        <Badge variant="success" className="font-mono text-[10.5px]">
          <CheckCircle2 className="h-3 w-3" />
          {isAdkPython ? "ADK Python CodeExec" : "Deterministic Verified Math"}
        </Badge>
      </div>

      <p className="text-sm sm:text-[14.5px] text-foreground/95 leading-relaxed font-medium">
        {math.summary}
      </p>

      {(math.python_code || math.python_stdout) && (
        <div>
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>{showCode ? "Hide Python execution trace" : "Inspect Python execution trace"}</span>
            {showCode ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {showCode && (
            <div className="mt-2.5 space-y-2">
              {math.python_code && (
                <pre className="rounded-xl bg-slate-950 text-slate-100 border border-slate-800 p-3.5 text-xs font-mono overflow-x-auto leading-relaxed">
                  {math.python_code}
                </pre>
              )}
              {math.python_stdout && (
                <div className="rounded-xl bg-slate-900 text-emerald-300 border border-slate-800 px-3.5 py-2.5 text-xs font-mono overflow-x-auto">
                  <span className="text-slate-400 select-none">stdout → </span>
                  {math.python_stdout}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
