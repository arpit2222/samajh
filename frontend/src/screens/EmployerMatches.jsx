"use client";

import React, { useEffect, useState } from "react";
import {
  Users,
  ShieldCheck,
  ExternalLink,
  ArrowLeft,
  Award,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { fetchRequisitionMatches } from "../api.js";
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

export default function EmployerMatches({ requisition, onBack }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMatches() {
    if (!requisition?.id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchRequisitionMatches(requisition.id);
      setMatches(res.matches || []);
    } catch (err) {
      setError(err.message || "Could not load candidate matches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMatches();
  }, [requisition?.id]);

  async function copyVerifyLink(credentialId) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/verify/${credentialId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Public verification link copied (open in Incognito to test)");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Users className="h-3.5 w-3.5" /> Ranked Candidate Matches
          </Badge>
          <Badge variant="secondary" className="font-mono">
            {matches.length} Discoverable Match{matches.length === 1 ? "" : "es"}
          </Badge>
        </div>
        <CardTitle className="pt-1">{requisition?.title}</CardTitle>
        <CardDescription>
          Showing only opt-in (`discoverable: true`) traders whose verified concept scores meet
          every threshold below, ranked highest overall score first.
        </CardDescription>

        <div className="flex items-center gap-1.5 flex-wrap pt-2">
          {(requisition?.required_concepts || []).map((rc) => (
            <Badge key={rc.name} variant="outline" className="font-mono text-xs">
              {rc.name} ≥ {rc.min_score}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="py-14 flex justify-center">
            <Spinner size="lg" label="Matching verified candidates..." />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={loadMatches} />
        ) : matches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-2">
            <p className="font-bold text-foreground">No candidates meet every threshold yet</p>
            <p className="text-sm text-muted-foreground">
              Try lowering one of the minimum score thresholds in a new requisition to expand the
              ranked pool.
            </p>
          </div>
        ) : (
          <div className="space-y-3.5">
            {matches.map((cand, index) => (
              <div
                key={cand.credentialId}
                className="rounded-2xl border border-border bg-muted/35 p-5 space-y-3.5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-brand-600 text-white font-extrabold font-mono flex items-center justify-center shrink-0">
                      #{index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-extrabold text-foreground">
                          {cand.displayName}
                        </span>
                        {cand.verified && (
                          <Badge variant="success" className="text-[10.5px]">
                            <ShieldCheck className="h-3 w-3" /> Verified
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        Credential: {cand.credentialId} · {cand.total_concepts_verified} concepts
                        verified
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="rounded-xl border border-border bg-card px-3.5 py-2 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Overall
                      </div>
                      <div className="text-xl font-extrabold font-mono text-brand-600 dark:text-brand-400 leading-none mt-0.5">
                        {cand.overall_score}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Matched concept breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(cand.matched_concepts || []).map((mc) => (
                    <div
                      key={mc.name}
                      className="rounded-xl border border-border bg-card px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-semibold text-foreground truncate">{mc.name}</span>
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                        {mc.effective_score}/100 (≥{mc.required_min})
                      </span>
                    </div>
                  ))}
                </div>

                {/* Public Verification Link Actions */}
                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Award className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                    Independently checkable without login
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => copyVerifyLink(cand.credentialId)}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy Verify URL
                    </Button>
                    <a
                      href={`/verify/${cand.credentialId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex"
                    >
                      <Button type="button" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" /> Public Verification
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to Requisitions
        </Button>
        <span className="text-xs font-mono text-muted-foreground">
          Deterministic threshold + overall_score ranking
        </span>
      </CardFooter>
    </Card>
  );
}
