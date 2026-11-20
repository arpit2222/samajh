"use client";

import React, { useEffect, useState } from "react";
import {
  Shuffle,
  Calendar,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Loader2,
  RotateCcw,
  Trophy,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { fetchMultiScenarios, submitMultiScenarios } from "../api.js";
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
import { Textarea } from "../components/ui/textarea.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { Progress } from "../components/ui/progress.jsx";
import MathVerificationCard from "../components/MathVerificationCard.jsx";

export default function MultiScenarioTest({ onExit }) {
  const [scenarios, setScenarios] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  async function loadBank() {
    setLoading(true);
    setError("");
    setReport(null);
    setCurrentIdx(0);
    setAnswers({});
    try {
      const data = await fetchMultiScenarios();
      setScenarios(data.scenarios || []);
    } catch (err) {
      setError(err.message || "Could not load randomized historical scenarios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBank();
  }, []);

  const current = scenarios[currentIdx];
  const currentAnswer = current ? answers[current.concept_tag] || "" : "";

  async function handleNextOrSubmit(e) {
    e.preventDefault();
    setError("");

    if (currentAnswer.trim().length < 15) {
      setError("Write at least a brief reasoning explanation (15+ characters) before continuing.");
      return;
    }

    if (currentIdx < scenarios.length - 1) {
      setCurrentIdx((i) => i + 1);
      return;
    }

    setGrading(true);
    try {
      const payload = scenarios.map((s) => ({
        concept_tag: s.concept_tag,
        user_reasoning: (answers[s.concept_tag] || "").trim(),
      }));
      const res = await submitMultiScenarios({ answers: payload });
      setReport(res);
      toast.success(`Multi-scenario gauntlet complete — Composite ${res.composite_score}/100`);
    } catch (err) {
      setError(err.message || "Could not grade multi-scenario gauntlet. Please try again.");
    } finally {
      setGrading(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-16 flex items-center justify-center">
          <Spinner size="lg" label="Shuffling curated historical events from Firestore..." />
        </CardContent>
      </Card>
    );
  }

  if (report) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="default">
              <Trophy className="h-3.5 w-3.5" /> Multi-Scenario Gauntlet Complete
            </Badge>
            <Badge variant={report.composite_score >= 80 ? "success" : "warning"}>
              Composite Score: {report.composite_score} / 100
            </Badge>
          </div>
          <CardTitle className="pt-1">Composite Stress-Test Report</CardTitle>
          <CardDescription>
            Evaluated across {report.total_scenarios} randomized real Indian market shocks via ADK
            StressTestAgent + Python Code Execution.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {report.results.map((r, idx) => (
            <div
              key={r.concept_tag}
              className="rounded-2xl border border-border bg-muted/40 p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-bold text-foreground">
                  {idx + 1}. {r.event}{" "}
                  <span className="font-mono text-xs text-muted-foreground">({r.date})</span>
                </div>
                <Badge variant={r.stress_score >= 80 ? "success" : r.stress_score >= 55 ? "warning" : "destructive"}>
                  {r.stress_score} / 100
                </Badge>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{r.feedback}</p>
              {r.math_verification && (
                <MathVerificationCard
                  math={r.math_verification}
                  title="Verified Position Impact"
                />
              )}
            </div>
          ))}
        </CardContent>

        <CardFooter className="flex-col-reverse sm:flex-row items-stretch sm:items-center">
          <Button type="button" variant="outline" onClick={onExit}>
            Back to Main Flow
          </Button>
          <Button type="button" onClick={loadBank}>
            <RotateCcw className="h-4 w-4" /> Reshuffle &amp; Retry Gauntlet
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="warning">
            <Shuffle className="h-3.5 w-3.5" /> Randomized Multi-Scenario Mode
          </Badge>
          {scenarios.length > 0 && (
            <Badge variant="secondary">
              Event {currentIdx + 1} of {scenarios.length}
            </Badge>
          )}
        </div>
        <CardTitle className="pt-1">Historical Shock Gauntlet</CardTitle>
        <CardDescription>
          Randomized curated events from Samajh&apos;s verified scenario bank — same reasoning
          grader, summed into one composite score.
        </CardDescription>
        {scenarios.length > 0 && (
          <div className="pt-2">
            <Progress value={Math.round(((currentIdx + 1) / scenarios.length) * 100)} />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {current ? (
          <form onSubmit={handleNextOrSubmit} className="space-y-4">
            <div className="rounded-2xl border border-border bg-muted/45 p-5 space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="destructive" className="font-mono">
                  <Calendar className="h-3 w-3" /> {current.date}
                </Badge>
                <Badge variant="success">
                  <ShieldCheck className="h-3 w-3" /> Verified Event
                </Badge>
              </div>
              <h3 className="text-lg font-extrabold text-foreground">{current.event}</h3>
              <p className="text-sm sm:text-[15px] text-foreground/90 leading-relaxed">
                {current.scenario_text}
              </p>
            </div>

            <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/10 p-4 text-sm font-medium text-foreground">
              {current.prompt_question}
            </div>

            <Textarea
              value={currentAnswer}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [current.concept_tag]: e.target.value }))
              }
              disabled={grading}
              rows={4}
              placeholder="Walk through the exact execution & margin consequences for the trader..."
            />

            {error && <ErrorBanner message={error} onRetry={() => setError("")} retryLabel="Dismiss" />}

            <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
              <Button type="button" variant="outline" onClick={onExit} disabled={grading}>
                Exit Gauntlet
              </Button>
              <Button type="submit" size="lg" disabled={grading}>
                {grading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Grading All Scenarios...
                  </>
                ) : currentIdx < scenarios.length - 1 ? (
                  <>
                    Next Randomized Event <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Grade Gauntlet &amp; Composite Score <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        ) : (
          <ErrorBanner
            message={error || "No scenarios found."}
            onRetry={loadBank}
            retryLabel="Retry"
          />
        )}
      </CardContent>
    </Card>
  );
}
