"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BarChart3, Lock, RefreshCw, Layers } from "lucide-react";
import { fetchEmployerCohortInsights } from "../api.js";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Input } from "../components/ui/input.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";
import { Progress } from "../components/ui/progress.jsx";

export default function CohortInsightsDashboard({ partnerId = "default" }) {
  const [activePartnerId, setActivePartnerId] = useState(partnerId);
  const [partnerInput, setPartnerInput] = useState(partnerId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchEmployerCohortInsights(activePartnerId);
      setData(res);
    } catch (err) {
      setError(err.message || "Could not load cohort weak-topic clusters.");
    } finally {
      setLoading(false);
    }
  }, [activePartnerId]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const clusters = data?.clusters || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <BarChart3 className="h-3.5 w-3.5" /> Cohort Weak-Topic Clustering
          </Badge>
          <div className="flex items-center gap-2">
            <Badge variant="success" className="text-[10.5px]">
              <Lock className="h-3 w-3" /> Aggregate-Only · Zero Individual Rows
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={loadInsights}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <CardTitle className="pt-1">Ranked Misconception Clusters</CardTitle>
        <CardDescription>
          Pre-computed by the scheduled Vertex AI embeddings &amp; Vector Search batch job. Shows
          aggregate concept gaps across your cohort — never individual trader identities.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const cleaned = partnerInput.trim() || "default";
            setActivePartnerId(cleaned);
          }}
          className="flex items-center gap-2 flex-wrap"
        >
          <Input
            type="text"
            value={partnerInput}
            onChange={(e) => setPartnerInput(e.target.value)}
            placeholder="Cohort / Partner ID (e.g. default, institute_nism_1)"
            className="max-w-xs h-9 text-xs font-mono"
          />
          <Button type="submit" size="sm" variant="outline" disabled={loading}>
            Load Cohort
          </Button>
        </form>

        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <Spinner size="md" label="Loading aggregate cohort clusters..." />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadInsights} retryLabel="Retry" />
        ) : clusters.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center space-y-1.5">
            <Layers className="h-6 w-6 text-muted-foreground mx-auto" />
            <p className="text-sm font-semibold text-foreground">
              No scheduled cluster snapshot yet for cohort &ldquo;{activePartnerId}&rdquo;
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Clusters are computed automatically by the scheduled batch job once sessions
              accumulate (never on individual API requests).
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
              <span>
                Total sessions analyzed:{" "}
                <strong className="font-mono text-foreground">
                  {data.total_sessions_analyzed}
                </strong>
              </span>
              <span className="font-mono text-[11px]">
                Backend: {data.vector_backend} · Last batch:{" "}
                {data.computed_at ? new Date(data.computed_at).toLocaleString("en-IN") : "Pending"}
              </span>
            </div>

            <div className="space-y-3">
              {clusters.map((cl) => (
                <div
                  key={cl.cluster_id}
                  className="rounded-xl border border-border bg-card p-4 space-y-2.5 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default" className="font-mono text-[10.5px]">
                          #{cl.rank}
                        </Badge>
                        <span className="font-bold text-sm text-foreground">{cl.label}</span>
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground">
                        subtopic: {cl.primary_subtopic}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-extrabold font-mono text-foreground">
                        {cl.session_count}
                        <span className="text-xs font-normal text-muted-foreground"> sessions</span>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {cl.pct_of_cohort}% of cohort
                      </div>
                    </div>
                  </div>

                  <Progress value={cl.pct_of_cohort} />

                  {Array.isArray(cl.top_themes) && cl.top_themes.length > 0 && (
                    <ul className="space-y-1 pt-1">
                      {cl.top_themes.map((theme) => (
                        <li
                          key={theme}
                          className="text-xs text-muted-foreground flex items-start gap-1.5"
                        >
                          <span className="text-brand-600 dark:text-brand-400">•</span>
                          <span>{theme}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
