"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Flame,
  Calendar,
  ShieldCheck,
  Target,
  AlertCircle,
  ArrowRight,
  Loader2,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { fetchStressScenario, submitStressReasoning } from "../api.js";
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

function formatEventDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Crisp zero-dependency inline SVG historical price-shock illustration.
 * Reflects the verified real figures from scenarioBank.json.
 */
function HistoricalShockVisual({ conceptTag }) {
  if (conceptTag === "general_market_risk") {
    return null;
  }

  if (conceptTag === "event_volatility_option_writing_risk") {
    return (
      <div className="rounded-xl border border-rose-200/80 dark:border-rose-500/25 bg-card p-4 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground flex-wrap gap-1">
          <span className="font-semibold text-foreground">NIFTY 50 / INDIA VIX · 4 Jun 2024</span>
          <span className="text-rose-600 dark:text-rose-400 font-bold">
            Nifty -5.93% (Intraday -8.5%) · VIX &gt; 28
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Sensex closed at <span className="font-mono font-semibold text-foreground">72,079.05</span> (-4,389.73 pts) after touching an intraday low of <span className="font-mono font-semibold text-foreground">70,234.43</span>; Nifty closed at <span className="font-mono font-semibold text-foreground">21,884.50</span> (intraday low <span className="font-mono font-semibold text-foreground">21,281.45</span>).
        </p>
      </div>
    );
  }

  if (conceptTag === "regulatory_moratorium_liquidity_risk") {
    return (
      <div className="rounded-xl border border-rose-200/80 dark:border-rose-500/25 bg-card p-4 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground flex-wrap gap-1">
          <span className="font-semibold text-foreground">YESBANK · NSE · 6 Mar 2020</span>
          <span className="text-rose-600 dark:text-rose-400 font-bold">
            -85% intraday · Low ~₹5.65
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Following the RBI moratorium and ₹50,000 depositor withdrawal cap announced late on March 5, 2020, liquidity evaporated at the open.
        </p>
      </div>
    );
  }

  if (conceptTag === "overnight_gap_stoploss_risk") {
    return (
      <div className="rounded-xl border border-rose-200/80 dark:border-rose-500/25 bg-card p-4 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span className="font-semibold text-foreground">INDUSINDBK · NSE Cash</span>
          <span className="text-rose-600 dark:text-rose-400 font-bold">
            -27.0% intraday · Close ₹656.80
          </span>
        </div>
        <svg viewBox="0 0 420 118" className="w-full h-28 overflow-visible" role="img" aria-label="IndusInd Bank overnight gap-down chart">
          <defs>
            <linearGradient id="gapFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e11d48" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#e11d48" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Prior close session */}
          <path
            d="M 10 24 L 95 26 L 148 22"
            fill="none"
            stroke="#64748b"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="148" cy="22" r="3.5" fill="#64748b" />
          <text x="12" y="15" fontSize="9.5" fill="currentColor" className="fill-muted-foreground font-mono">
            Mar 10 Close (Disclosure after hours)
          </text>

          {/* Planned Stop-Loss dashed line */}
          <line
            x1="10"
            y1="40"
            x2="408"
            y2="40"
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <text x="235" y="36" fontSize="9.5" fill="#d97706" className="font-mono font-semibold">
            Trader&apos;s -3% Stop-Loss (Gapped Through)
          </text>

          {/* Overnight vertical gap */}
          <line
            x1="148"
            y1="22"
            x2="178"
            y2="78"
            stroke="#e11d48"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <rect x="150" y="47" width="84" height="16" rx="4" fill="#e11d48" fillOpacity="0.14" />
          <text x="155" y="58" fontSize="9" fill="#e11d48" className="font-mono font-bold">
            -20% GAP OPEN
          </text>

          {/* Next day selloff to -27% */}
          <path
            d="M 178 78 L 245 84 L 320 96 L 406 102"
            fill="none"
            stroke="#e11d48"
            strokeWidth="2.75"
            strokeLinecap="round"
          />
          <path
            d="M 178 78 L 245 84 L 320 96 L 406 102 L 406 114 L 178 114 Z"
            fill="url(#gapFill)"
          />
          <circle cx="178" cy="78" r="4" fill="#e11d48" />
          <circle cx="406" cy="102" r="4" fill="#e11d48" />
          <text x="302" y="114" fontSize="9.5" fill="#e11d48" className="font-mono font-bold">
            Close ₹656.80 (-27%)
          </text>
        </svg>
      </div>
    );
  }

  // Default: 23 Mar 2020 Sensex/Nifty 10% lower-circuit halt
  return (
    <div className="rounded-xl border border-rose-200/80 dark:border-rose-500/25 bg-card p-4 space-y-2">
      <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
        <span className="font-semibold text-foreground">SENSEX / NIFTY 50 · 23 Mar 2020</span>
        <span className="text-rose-600 dark:text-rose-400 font-bold">
          -13.15% Sensex · -12.98% Nifty
        </span>
      </div>
      <svg viewBox="0 0 420 118" className="w-full h-28 overflow-visible" role="img" aria-label="Sensex and Nifty lower circuit trading halt chart">
        <defs>
          <linearGradient id="haltFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e11d48" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#e11d48" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Halt shaded band */}
        <rect x="132" y="14" width="116" height="96" rx="6" fill="#f59e0b" fillOpacity="0.12" />
        <line x1="132" y1="14" x2="132" y2="110" stroke="#d97706" strokeDasharray="3 3" strokeWidth="1.2" />
        <line x1="248" y1="14" x2="248" y2="110" stroke="#d97706" strokeDasharray="3 3" strokeWidth="1.2" />
        <text x="142" y="28" fontSize="9.5" fill="#d97706" className="font-mono font-bold">
          45-MIN CIRCUIT HALT
        </text>
        <text x="146" y="41" fontSize="8.5" fill="#d97706" className="font-mono">
          No exits · Frozen LTP
        </text>

        {/* Pre-halt drop to -10% */}
        <path
          d="M 12 22 L 58 42 L 102 62 L 132 76"
          fill="none"
          stroke="#e11d48"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="132" cy="76" r="4" fill="#d97706" />
        <text x="14" y="72" fontSize="9" fill="#e11d48" className="font-mono font-semibold">
          -10% Lower Circuit
        </text>

        {/* Frozen line across halt */}
        <line
          x1="132"
          y1="76"
          x2="248"
          y2="76"
          stroke="#d97706"
          strokeWidth="2"
          strokeDasharray="4 4"
        />

        {/* Post-reopen plunge to -13.15% */}
        <path
          d="M 248 76 L 295 94 L 352 98 L 406 102"
          fill="none"
          stroke="#e11d48"
          strokeWidth="2.75"
          strokeLinecap="round"
        />
        <path
          d="M 248 76 L 295 94 L 352 98 L 406 102 L 406 112 L 248 112 Z"
          fill="url(#haltFill)"
        />
        <circle cx="248" cy="76" r="4" fill="#e11d48" />
        <circle cx="406" cy="102" r="4" fill="#e11d48" />
        <text x="275" y="114" fontSize="9.5" fill="#e11d48" className="font-mono font-bold">
          Close 25,981 (-13.15%)
        </text>
      </svg>
    </div>
  );
}

export default function StressTest({ sessionData, examResult, onCompleted }) {
  const [scenario, setScenario] = useState(null);
  const [loadingScenario, setLoadingScenario] = useState(true);
  const [userReasoning, setUserReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchedRef = useRef(null);

  async function loadScenario() {
    setLoadingScenario(true);
    setError("");
    try {
      const data = await fetchStressScenario({ sessionId: sessionData.sessionId });
      setScenario(data);
    } catch (err) {
      setError(err.message || "Could not load historical scenario from Firestore.");
    } finally {
      setLoadingScenario(false);
    }
  }

  useEffect(() => {
    if (!sessionData?.sessionId) return;
    if (fetchedRef.current === sessionData.sessionId) return;
    fetchedRef.current = sessionData.sessionId;
    loadScenario();
  }, [sessionData?.sessionId]);

  async function handleSubmit(e) {
    e?.preventDefault();
    const trimmed = userReasoning.trim();
    if (trimmed.length < 15) {
      setError("Write at least a couple of sentences explaining what happens to the position and why.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const result = await submitStressReasoning({
        sessionId: sessionData.sessionId,
        user_reasoning: trimmed,
      });
      onCompleted(result);
    } catch (err) {
      setError(err.message || "Could not grade your stress-test reasoning. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="warning">
            <Flame className="h-3.5 w-3.5" /> Step 5 of 6 · Consequence Stress-Test
          </Badge>
          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified Historical Event
          </Badge>
        </div>
        <CardTitle className="pt-1">Reason through a real market shock</CardTitle>
        <CardDescription>
          This is <strong className="text-foreground">not a trading simulator</strong> — no fake
          P&amp;L luck. Samajh retrieved a documented historical event matched to your weak spot and
          grades your causal reasoning.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {loadingScenario ? (
          <div className="rounded-2xl border border-border bg-muted/40 py-14 flex items-center justify-center">
            <Spinner size="lg" label="Retrieving matching historical event from curated scenario bank..." />
          </div>
        ) : scenario ? (
          <>
            {/* Verified Historical Event Dossier */}
            <div className="rounded-2xl border border-border bg-muted/45 p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="destructive" className="font-mono">
                    <Calendar className="h-3 w-3" /> {formatEventDate(scenario.date)}
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    <Target className="h-3 w-3 text-rose-500" /> Matched to:{" "}
                    {examResult?.weak_subtopic || scenario.concept_tag}
                  </Badge>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  Ground-Truth Bank
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-lg sm:text-xl font-extrabold text-foreground tracking-tight">
                  <TrendingDown className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>{scenario.event}</span>
                </div>
                <p className="text-sm sm:text-[15.5px] text-foreground/90 leading-relaxed">
                  {scenario.scenario_text}
                </p>
              </div>

              <HistoricalShockVisual conceptTag={scenario.concept_tag} />
            </div>

            {/* Position Reasoning Prompt + Input */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300 mb-1">
                  Your Stress-Test Question
                </div>
                <p className="text-sm sm:text-[15px] font-medium text-foreground leading-relaxed">
                  {scenario.prompt_question}
                </p>
              </div>

              <Textarea
                value={userReasoning}
                onChange={(e) => setUserReasoning(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={submitting}
                rows={5}
                placeholder="Explain step-by-step what happens to the trader's order execution, exit ability, and margin/risk in this real event... (⌘/Ctrl + Enter to submit)"
              />

              {error && (
                <ErrorBanner
                  message={error}
                  onRetry={() => handleSubmit()}
                  retryLabel="Retry Grading"
                />
              )}

              <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground">
                  Graded against documented historical reasoning chain
                </span>
                <Button
                  type="submit"
                  size="lg"
                  disabled={submitting || userReasoning.trim().length < 5}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Grading Stress-Test Reasoning...
                    </>
                  ) : (
                    <>
                      Submit Reasoning &amp; Reveal Mastery <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <ErrorBanner
            message={error || "Could not load historical scenario."}
            onRetry={loadScenario}
            retryLabel="Retry"
          />
        )}
      </CardContent>

      {scenario && (
        <CardFooter className="text-xs text-muted-foreground">
          <span>Source: Curated Indian Market Scenario Bank ({scenario.concept_tag})</span>
          <span className="font-mono">RAG Retrieval · Zero Hallucinated Events</span>
        </CardFooter>
      )}
    </Card>
  );
}
