"use client";

import React from "react";
import { BookOpen, Lightbulb, ArrowRight, RotateCcw, ShieldAlert, MessageCircleQuestion } from "lucide-react";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Badge } from "../components/ui/badge.jsx";

export default function ConceptCard({ sessionData, onProceed, onReset }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <BookOpen className="h-3.5 w-3.5" /> Step 2 · Concept Card
          </Badge>
          <Badge variant="success">Extracted &amp; Ready</Badge>
        </div>
        <CardTitle className="pt-1">Lock in the core mechanism</CardTitle>
        <CardDescription>
          Take 15 seconds to internalize why this works. Next, you&apos;ll explain it in your own
          words to a confused novice who will intentionally get one detail wrong.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Core Concept Spotlight */}
        <div className="rounded-2xl border border-border bg-muted/45 p-5 sm:p-6 space-y-2.5">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
            Core Financial Concept
          </div>
          <p className="text-base sm:text-[18px] font-bold text-foreground leading-relaxed">
            {sessionData.concept}
          </p>
        </div>

        {/* Editorial Pull-Quote Analogy */}
        <div className="relative rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-gradient-to-br from-emerald-50/90 via-blue-50/50 to-card dark:from-emerald-500/12 dark:via-blue-500/10 dark:to-card p-5 sm:p-6 pl-6 sm:pl-7 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-blue-600 to-emerald-500" />
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300 mb-2">
            <Lightbulb className="h-4 w-4" /> Trading-Flavored Analogy
          </div>
          <p className="text-sm sm:text-[15.5px] text-foreground/90 leading-relaxed">
            {sessionData.analogy}
          </p>
        </div>

        {/* NISM Workbook RAG Grounding Citations */}
        {sessionData.grounding?.citations?.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Grounded in:
              </span>
              {sessionData.grounding.citations.map((c) => (
                <Badge key={c.id} variant="secondary" className="text-[11px]">
                  {c.source}
                </Badge>
              ))}
            </div>
            <span className="text-[10.5px] font-mono text-muted-foreground">
              {sessionData.grounding.engine === "vertex-ai-search"
                ? "Vertex AI Search"
                : "NISM Workbook RAG"}
            </span>
          </div>
        )}

        {/* Next-step briefing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
            <MessageCircleQuestion className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-[13px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">3-turn Socratic probe:</strong> Catch the
              novice&apos;s planted misconception and defend the mechanism.
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/8 p-4 flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-[13px] text-amber-900/90 dark:text-amber-100/90 leading-relaxed">
              <strong className="text-amber-950 dark:text-amber-200">Zero jargon bonus:</strong>{" "}
              Examiner grades causal reasoning, never copied textbook definitions.
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-col-reverse sm:flex-row items-stretch sm:items-center">
        <Button type="button" variant="outline" onClick={onReset}>
          <RotateCcw className="h-4 w-4" /> Different Page
        </Button>
        <Button type="button" size="lg" onClick={onProceed}>
          Teach it back <ArrowRight className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
