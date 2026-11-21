"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Clock, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { fetchMySessions } from "../api.js";
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
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";

const MODULE_LABELS = {
  "series-viii": "Series VIII · Derivatives",
  "series-va": "Series V-A · Mutual Funds",
  "series-i": "Series I · Currency",
};

export default function SessionHistory({ user, onRequestSignIn, onStartNew, onBack }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    if (!user || user.isGuest) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetchMySessions();
      setSessions(res.sessions || []);
    } catch (err) {
      setError(err.message || "Could not load your verification history.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Clock className="h-3.5 w-3.5" /> Verification History
          </Badge>
          {!user?.isGuest && (
            <Button type="button" variant="ghost" size="sm" onClick={loadHistory} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          )}
        </div>
        <CardTitle className="pt-1">Your Past Verifications</CardTitle>
        <CardDescription>
          Track your causal reasoning scores, weak subtopics, and NISM module progress over time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {user?.isGuest ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-3">
            <ShieldCheck className="h-8 w-8 text-brand-600 dark:text-brand-400 mx-auto" />
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-bold text-foreground">
                Sign in to save your verification history
              </p>
              <p className="text-xs text-muted-foreground">
                Guest sessions are anonymous and ephemeral. Sign in with Google or Email to build
                your permanent score timeline and verifiable credential.
              </p>
            </div>
            <Button type="button" onClick={onRequestSignIn}>
              Sign In to Save History
            </Button>
          </div>
        ) : loading ? (
          <div className="py-12 flex items-center justify-center">
            <Spinner size="md" label="Loading your sessions..." />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadHistory} retryLabel="Retry" />
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-3">
            <BookOpen className="h-8 w-8 text-muted-foreground mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">No completed verifications yet</p>
              <p className="text-xs text-muted-foreground">
                Run your first 3-minute NISM teach-back to see your causal reasoning score here.
              </p>
            </div>
            <Button type="button" onClick={onStartNew}>
              Start First Verification
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const score =
                typeof s.combinedMasteryScore === "number"
                  ? s.combinedMasteryScore
                  : typeof s.examinerScore === "number"
                    ? s.examinerScore
                    : null;
              const badgeVariant =
                score === null
                  ? "secondary"
                  : score >= 80
                    ? "success"
                    : score >= 55
                      ? "warning"
                      : "destructive";

              return (
                <div
                  key={s.sessionId}
                  className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10.5px] font-mono">
                        {MODULE_LABELS[s.nismModule] || "Series VIII · Derivatives"}
                      </Badge>
                      {s.language && s.language !== "en-IN" && (
                        <Badge variant="secondary" className="text-[10.5px] font-mono">
                          {s.language}
                        </Badge>
                      )}
                      {s.timestamp && (
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {new Date(s.timestamp).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-foreground line-clamp-1">
                      {s.concept || "Financial Concept Verification"}
                    </p>
                    {s.weakSubtopic && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Target className="h-3 w-3 text-rose-500 shrink-0" />
                        <span>Weak spot: {s.weakSubtopic}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={badgeVariant} className="font-mono text-xs px-2.5 py-1">
                      {score !== null ? `${score} / 100` : "In Progress"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 flex-wrap">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button type="button" onClick={onStartNew}>
          New Verification
        </Button>
      </CardFooter>
    </Card>
  );
}
