"use client";

import React, { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  Trophy,
  RotateCcw,
  Target,
  ShieldCheck,
  BookOpen,
  Flame,
  Copy,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  Shuffle,
  MessageSquareText,
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

function getMasteryVerdict(score) {
  if (score >= 80) {
    return {
      title: "Verified Ready",
      subtitle: "Your causal reasoning held up under both teach-back probing and real historical market stress.",
      badgeVariant: "success",
      stroke: "#059669",
      textClass: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (score >= 55) {
    return {
      title: "Developing — Revisit Before Risking Capital",
      subtitle: "You grasp the core idea, but real market edge cases still exposed a gap worth tightening.",
      badgeVariant: "warning",
      stroke: "#d97706",
      textClass: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    title: "Capital Safeguard Triggered",
    subtitle: "Critical mechanism blind spots detected — revisit the highlighted concept before trading live capital.",
    badgeVariant: "destructive",
    stroke: "#e11d48",
    textClass: "text-rose-600 dark:text-rose-400",
  };
}

export default function ResultScreen({
  user,
  sessionData,
  examResult,
  stressResult,
  onRequestSignIn,
  onStartMultiScenario,
  onOpenLeaderboard,
  onOpenDiscussion,
  onOpenCredential,
  onReset,
}) {
  const examinerScore = Math.max(
    0,
    Math.min(100, Number(stressResult?.examiner_score ?? examResult?.score ?? 0))
  );
  const stressScore = Math.max(0, Math.min(100, Number(stressResult?.stress_score ?? 0)));
  const combinedScore = Math.max(
    0,
    Math.min(
      100,
      Number(
        stressResult?.combined_mastery_score ??
          Math.round(examinerScore * 0.5 + stressScore * 0.5)
      )
    )
  );

  const conceptToRevisit =
    stressResult?.concept_to_revisit || examResult?.weak_subtopic || "Core risk mechanism";

  const [displayScore, setDisplayScore] = useState(0);
  const confettiFiredRef = useRef(false);

  // Count-up animation for combined mastery dial
  useEffect(() => {
    let rafId;
    const duration = 800;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(combinedScore * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [combinedScore]);

  // Subtle celebratory burst ONLY when combined mastery >= 80
  useEffect(() => {
    if (combinedScore >= 80 && !confettiFiredRef.current) {
      confettiFiredRef.current = true;
      confetti({
        particleCount: 55,
        spread: 65,
        origin: { y: 0.62 },
        colors: ["#059669", "#2563eb", "#10b981", "#f59e0b"],
      });
    }
  }, [combinedScore]);

  const verdict = getMasteryVerdict(combinedScore);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - displayScore / 100);

  async function handleCopySummary() {
    const summary = [
      `Samajh Verification Report — ${verdict.title}`,
      `Combined Mastery Score: ${combinedScore}/100 (Teach-Back: ${examinerScore}/100 | Stress-Test: ${stressScore}/100)`,
      `Concept: ${sessionData.concept}`,
      `Historical Stress-Test: ${stressResult.event} (${stressResult.date})`,
      `One Concept to Revisit: ${conceptToRevisit}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Mastery summary copied to clipboard");
    } catch {
      toast.error("Could not access clipboard");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Trophy className="h-3.5 w-3.5" /> Step 6 of 6 · Final Mastery Report
          </Badge>
          <Badge variant={verdict.badgeVariant}>{verdict.title}</Badge>
        </div>
        <CardTitle className="pt-1">Combined Understanding Verdict</CardTitle>
        <CardDescription>{verdict.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Combined Mastery Dial + Score Breakdown */}
        <div className="rounded-2xl border border-border bg-muted/45 p-6 grid grid-cols-1 md:grid-cols-[170px_1fr] gap-6 items-center">
          <div className="relative h-40 w-40 mx-auto flex items-center justify-center">
            <svg className="h-40 w-40 -rotate-90" viewBox="0 0 144 144">
              <circle
                cx="72"
                cy="72"
                r={radius}
                fill="none"
                className="stroke-slate-200 dark:stroke-slate-800"
                strokeWidth="11"
              />
              <circle
                cx="72"
                cy="72"
                r={radius}
                fill="none"
                stroke={verdict.stroke}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Mastery
              </span>
              <span className={`text-4xl font-extrabold font-mono leading-none mt-0.5 ${verdict.textClass}`}>
                {displayScore}
              </span>
              <span className="text-xs text-muted-foreground font-mono mt-0.5">/ 100</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="rounded-xl border border-border bg-card p-4 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Teach-Back Score
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">50% weight</span>
              </div>
              <div className="text-2xl font-extrabold font-mono text-foreground">
                {examinerScore}
                <span className="text-sm font-normal text-muted-foreground"> / 100</span>
              </div>
              <p className="text-xs text-muted-foreground">
                3-turn Socratic reasoning defense
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Stress-Test Score
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">50% weight</span>
              </div>
              <div className="text-2xl font-extrabold font-mono text-foreground">
                {stressScore}
                <span className="text-sm font-normal text-muted-foreground"> / 100</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {stressResult.event} ({stressResult.date})
              </p>
            </div>
          </div>
        </div>

        {/* The One Concept to Revisit */}
        <div className="relative rounded-2xl border border-rose-200 dark:border-rose-500/40 bg-gradient-to-r from-rose-50 via-rose-50/40 to-card dark:from-rose-500/15 dark:via-rose-500/8 dark:to-card p-5 sm:p-6 pl-6 sm:pl-7 overflow-hidden space-y-1.5">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500" />
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">
            <Target className="h-4 w-4" /> The One Concept To Revisit
          </div>
          <p className="text-xl sm:text-2xl font-extrabold text-rose-950 dark:text-rose-50 tracking-tight capitalize">
            {conceptToRevisit}
          </p>
          <p className="text-xs sm:text-sm text-rose-800/80 dark:text-rose-200/80">
            Focus your next NISM revision session here before moving on to the next chapter.
          </p>
        </div>

        {/* Stress-Test Feedback */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-2 shadow-xs">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
            <FileCheck2 className="h-4 w-4" /> Stress-Test Reasoning Feedback
          </div>
          <p className="text-sm sm:text-[15px] text-foreground/90 leading-relaxed">
            {stressResult.feedback}
          </p>
        </div>

        {/* ADK Code Execution Verified Position Impact */}
        {stressResult.math_verification && (
          <MathVerificationCard
            math={stressResult.math_verification}
            title="ADK Verified Historical Position Impact"
          />
        )}

        {/* Ground-Truth Reasoning Chain Comparison */}
        {stressResult.correct_reasoning_chain && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-5 space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" /> Documented Ground-Truth Mechanism ({stressResult.date})
            </div>
            <p className="text-sm text-emerald-950/90 dark:text-emerald-100/90 leading-relaxed">
              {stressResult.correct_reasoning_chain}
            </p>
          </div>
        )}

        {/* Contextual Guest Nudge */}
        {user?.isGuest && onRequestSignIn && (
          <div className="rounded-2xl border border-brand-200 dark:border-brand-500/35 bg-brand-50/70 dark:bg-brand-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-foreground">
                Save this {combinedScore}/100 score to your Verified Credential
              </p>
              <p className="text-xs text-muted-foreground">
                Guest sessions are temporary. Sign in with Google or Email to build a permanent
                tamper-evident NISM understanding profile.
              </p>
            </div>
            <Button type="button" size="sm" onClick={onRequestSignIn} className="shrink-0">
              Sign In to Save
            </Button>
          </div>
        )}

        {/* Clean "What's Next" 2-column action grid instead of 6 competing footer buttons */}
        <div className="space-y-2.5 pt-1">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            What&apos;s Next
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {onOpenCredential && (
              <button
                type="button"
                onClick={onOpenCredential}
                className="text-left rounded-xl border border-border bg-card hover:bg-muted/50 p-3.5 flex items-center gap-3 transition-colors cursor-pointer"
              >
                <span className="h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">My Verified Credential</p>
                  <p className="text-xs text-muted-foreground">View &amp; share your HMAC-signed profile</p>
                </div>
              </button>
            )}
            {onStartMultiScenario && (
              <button
                type="button"
                onClick={onStartMultiScenario}
                className="text-left rounded-xl border border-border bg-card hover:bg-muted/50 p-3.5 flex items-center gap-3 transition-colors cursor-pointer"
              >
                <span className="h-9 w-9 rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0">
                  <Shuffle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">Multi-Scenario Gauntlet</p>
                  <p className="text-xs text-muted-foreground">Test yourself across multiple market shocks</p>
                </div>
              </button>
            )}
            {onOpenLeaderboard && (
              <button
                type="button"
                onClick={onOpenLeaderboard}
                className="text-left rounded-xl border border-border bg-card hover:bg-muted/50 p-3.5 flex items-center gap-3 transition-colors cursor-pointer"
              >
                <span className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Trophy className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">Comprehension Leaderboard</p>
                  <p className="text-xs text-muted-foreground">Compare scores anonymously or opt in</p>
                </div>
              </button>
            )}
            {onOpenDiscussion && (
              <button
                type="button"
                onClick={() => onOpenDiscussion(stressResult?.concept_tag)}
                className="text-left rounded-xl border border-border bg-card hover:bg-muted/50 p-3.5 flex items-center gap-3 transition-colors cursor-pointer"
              >
                <span className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <MessageSquareText className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">Discussion Circle</p>
                  <p className="text-xs text-muted-foreground">Swap pattern notes on this exact gap</p>
                </div>
              </button>
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex-col-reverse sm:flex-row items-stretch sm:items-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {combinedScore >= 80 ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <span>Full 6-step verification recorded</span>
        </div>

        <div className="flex items-center gap-2.5 flex-col sm:flex-row">
          <Button type="button" variant="outline" onClick={handleCopySummary}>
            <Copy className="h-4 w-4" /> Copy Summary
          </Button>
          <Button type="button" size="lg" onClick={onReset}>
            <RotateCcw className="h-4 w-4" /> Verify Another Concept
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
