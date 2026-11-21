"use client";

import React, { useEffect, useState } from "react";
import {
  Trophy,
  ArrowLeft,
  Shuffle,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  EyeOff,
} from "lucide-react";
import { fetchGauntletLeaderboard } from "../api.js";
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

function formatCompletedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeaderboardScreen({
  scenarioSetId = "nism-viii-gauntlet",
  onStartGauntlet,
  onBack,
}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadLeaderboard() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchGauntletLeaderboard({
        scenario_set_id: scenarioSetId,
        limit: 20,
      });
      setEntries(res.leaderboard || []);
    } catch (err) {
      setError(err.message || "Could not load the comprehension leaderboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLeaderboard();
  }, [scenarioSetId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Trophy className="h-3.5 w-3.5" /> Comprehension Leaderboard
          </Badge>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px]">
              {scenarioSetId}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={loadLeaderboard}
              disabled={loading}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
        <CardTitle className="pt-1">Multi-Scenario Gauntlet Rankings</CardTitle>
        <CardDescription>
          Ranked strictly by human comprehension score (composite stress-test reasoning across real
          historical shocks). Ties are broken by earliest completion — never P&amp;L luck.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Privacy Notice */}
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-start gap-2.5 text-xs text-muted-foreground">
          <EyeOff className="h-4 w-4 shrink-0 mt-0.5 text-brand-600 dark:text-brand-400" />
          <span>
            <strong className="text-foreground">Privacy by default:</strong> Guest runs and private
            accounts appear as <em>Anonymous Learner</em>. Your display name appears only if you opt
            in via the Discoverability toggle on your Credential Profile.
          </span>
        </div>

        {loading ? (
          <div className="py-14 flex justify-center">
            <Spinner size="lg" label="Loading ranked comprehension scores..." />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadLeaderboard} />
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-4">
            <Trophy className="h-8 w-8 text-brand-600 dark:text-brand-400 mx-auto" />
            <div className="space-y-1">
              <p className="font-bold text-foreground">No gauntlet runs recorded yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Complete the Multi-Scenario Gauntlet to claim the #1 spot on the comprehension
                leaderboard.
              </p>
            </div>
            {onStartGauntlet && (
              <Button type="button" onClick={onStartGauntlet}>
                <Shuffle className="h-4 w-4" /> Start Multi-Scenario Gauntlet
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-4 font-bold">Rank</th>
                  <th className="py-3 px-4 font-bold">Learner</th>
                  <th className="py-3 px-4 font-bold text-right">Composite Score</th>
                  <th className="py-3 px-4 font-bold">Completed</th>
                  <th className="py-3 px-4 font-bold text-right">Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((row) => (
                  <tr key={row.run_id} className="bg-card text-foreground">
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-extrabold ${
                          row.rank === 1
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
                            : row.rank === 2
                              ? "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                              : row.rank === 3
                                ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        #{row.rank}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={
                            row.opted_in ? "font-bold text-foreground" : "italic text-muted-foreground"
                          }
                        >
                          {row.display_name}
                        </span>
                        {row.opted_in && (
                          <Badge variant="success" className="text-[10px]">
                            <ShieldCheck className="h-3 w-3" /> Opted In
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-extrabold text-brand-600 dark:text-brand-400">
                      {row.composite_score}
                      <span className="text-xs font-normal text-muted-foreground"> / 100</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                      {formatCompletedAt(row.completed_at)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {row.credential_id ? (
                        <a
                          href={`/verify/${row.credential_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex"
                        >
                          <Button type="button" size="sm" variant="outline">
                            <ExternalLink className="h-3.5 w-3.5" /> Verify
                          </Button>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Private</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-col-reverse sm:flex-row items-stretch sm:items-center">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {onStartGauntlet && (
          <Button type="button" onClick={onStartGauntlet}>
            <Shuffle className="h-4 w-4" /> Take Multi-Scenario Gauntlet
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
