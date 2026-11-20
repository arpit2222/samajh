"use client";

import React, { useEffect, useState } from "react";
import {
  Award,
  RotateCcw,
  Target,
  FileCheck2,
  Flame,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
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
import MathVerificationCard from "../components/MathVerificationCard.jsx";

function getScoreTier(score) {
  if (score >= 80) {
    return {
      label: "Strong Conceptual Base",
      badgeVariant: "success",
      stroke: "#059669",
      textClass: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (score >= 55) {
    return {
      label: "Partial — Blind Spot Detected",
      badgeVariant: "warning",
      stroke: "#d97706",
      textClass: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    label: "High Risk — Gap Detected",
    badgeVariant: "destructive",
    stroke: "#e11d48",
    textClass: "text-rose-600 dark:text-rose-400",
  };
}

export default function ScoreReveal({ sessionData, examResult, onStartStressTest, onReset }) {
  const targetScore = Math.max(0, Math.min(100, Number(examResult?.score ?? 0)));
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    let rafId;
    const duration = 700;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(targetScore * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [targetScore]);

  const tier = getScoreTier(targetScore);
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - displayScore / 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Award className="h-3.5 w-3.5" /> Step 4 of 6 · Teach-Back Verdict
          </Badge>
          <Badge variant={tier.badgeVariant}>{tier.label}</Badge>
        </div>
        <CardTitle className="pt-1">Understanding Diagnosis</CardTitle>
        <CardDescription>
          Graded strictly on your own causal explanations — now let&apos;s stress-test your weak
          spot against a real Indian market event.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Hero Score Ring + Concept summary */}
        <div className="rounded-2xl border border-border bg-muted/45 p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="relative h-36 w-36 shrink-0 flex items-center justify-center">
            <svg className="h-36 w-36 -rotate-90" viewBox="0 0 132 132">
              <circle
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth="10"
              />
              <circle
                cx="66"
                cy="66"
                r={radius}
                fill="none"
                stroke={tier.stroke}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-extrabold font-mono leading-none ${tier.textClass}`}>
                {displayScore}
              </span>
              <span className="text-xs text-muted-foreground font-mono mt-1">/ 100</span>
            </div>
          </div>

          <div className="space-y-2 text-center sm:text-left">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Tested Concept
            </div>
            <p className="text-sm sm:text-base font-semibold text-foreground leading-relaxed">
              {sessionData.concept}
            </p>
          </div>
        </div>

        {/* Named Weak Sub-Topic Hero Panel */}
        <div className="relative rounded-2xl border border-rose-200 dark:border-rose-500/40 bg-gradient-to-r from-rose-50 via-rose-50/40 to-card dark:from-rose-500/15 dark:via-rose-500/8 dark:to-card p-5 sm:p-6 pl-6 sm:pl-7 overflow-hidden space-y-1.5">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500" />
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">
            <Target className="h-4 w-4" /> Specific Weak Sub-Topic Identified
          </div>
          <p className="text-xl sm:text-2xl font-extrabold text-rose-950 dark:text-rose-50 tracking-tight capitalize">
            {examResult.weak_subtopic}
          </p>
          <p className="text-xs sm:text-sm text-rose-800/80 dark:text-rose-200/80">
            This exact mechanism will now be tested against a documented historical Indian market
            shock.
          </p>
        </div>

        {/* Examiner Rationale */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-2 shadow-xs">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
            <FileCheck2 className="h-4 w-4" /> Examiner Rationale
          </div>
          <p className="text-sm sm:text-[15px] text-foreground/90 leading-relaxed">
            {examResult.rationale}
          </p>
        </div>

        {/* ADK Python Code Execution Verified Math */}
        {examResult.math_verification && (
          <MathVerificationCard
            math={examResult.math_verification}
            title="ADK Verified Financial Math Check"
          />
        )}

        {/* NISM Workbook Grounding Citations */}
        {examResult.grounding?.citations?.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Verified Against:
              </span>
              {examResult.grounding.citations.map((c) => (
                <Badge key={c.id} variant="secondary" className="text-[11px]">
                  {c.source}
                </Badge>
              ))}
            </div>
            <span className="text-[10.5px] font-mono text-muted-foreground">
              {examResult.grounding.engine === "vertex-ai-search"
                ? "Vertex AI Search"
                : "NISM Workbook RAG"}
            </span>
          </div>
        )}

        {/* Live Stage 2 Callout */}
        <div className="rounded-2xl border border-amber-200 dark:border-amber-500/35 bg-amber-50/80 dark:bg-amber-500/10 p-5 flex items-start gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/35 flex items-center justify-center text-amber-700 dark:text-amber-300 shrink-0">
            <Flame className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">
                Up Next: Real Historical Market Stress-Test
              </p>
              <Badge variant="warning" className="text-[10px]">
                <ShieldCheck className="h-3 w-3" /> Ground Truth · Not Simulated
              </Badge>
            </div>
            <p className="text-xs sm:text-[13px] text-amber-900/85 dark:text-amber-200/85 leading-relaxed">
              No fake P&amp;L luck — Samajh retrieves a real, dated Indian market shock tied to{" "}
              <strong>&ldquo;{examResult.weak_subtopic}&rdquo;</strong> and grades your reasoning
              about what happens to an open position.
            </p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-col-reverse sm:flex-row items-stretch sm:items-center">
        <Button type="button" variant="outline" onClick={onReset}>
          <RotateCcw className="h-4 w-4" /> Start Over
        </Button>
        <Button type="button" size="lg" onClick={onStartStressTest}>
          Enter Consequence Stress-Test <ArrowRight className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
