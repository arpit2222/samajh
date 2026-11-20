"use client";

import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  Copy,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  Award,
  ArrowLeft,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchMyCredential,
  generateMyCredential,
  setCredentialDiscoverable,
} from "../api.js";
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

export default function CredentialProfile({ user, onRequestSignIn, onBack }) {
  const isGuest = !user || Boolean(user.isGuest) || !user.uid;
  const [credential, setCredential] = useState(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(!isGuest);
  const [generating, setGenerating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  async function loadCredential() {
    if (isGuest) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetchMyCredential();
      setCredential(res.credential || null);
      setVerified(Boolean(res.verified));
    } catch (err) {
      setError(err.message || "Could not load your credential profile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCredential();
  }, [user?.uid]);

  async function handleGenerate() {
    setError("");
    setGenerating(true);
    try {
      const res = await generateMyCredential();
      setCredential(res.credential);
      setVerified(Boolean(res.verified));
      toast.success("Tamper-evident HMAC-SHA256 credential updated");
    } catch (err) {
      setError(err.message || "Could not generate credential.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggleDiscoverable() {
    if (!credential) return;
    setError("");
    setToggling(true);
    try {
      const next = !credential.discoverable;
      const res = await setCredentialDiscoverable(next);
      setCredential(res.credential);
      toast.success(
        next
          ? "Profile is now discoverable by verified employers"
          : "Profile is now private (hidden from employer searches)"
      );
    } catch (err) {
      setError(err.message || "Could not update discoverability.");
    } finally {
      setToggling(false);
    }
  }

  function getShareUrl() {
    if (!credential?.credentialId || typeof window === "undefined") return "";
    return `${window.location.origin}/verify/${credential.credentialId}`;
  }

  async function handleCopyLink() {
    const url = getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Shareable verification link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Award className="h-3.5 w-3.5" /> Trader Credential Profile
          </Badge>
          {credential && (
            <Badge variant={verified ? "success" : "destructive"}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {verified ? "HMAC-SHA256 Verified" : "Signature Invalid"}
            </Badge>
          )}
        </div>
        <CardTitle className="pt-1">Your Verifiable Understanding Record</CardTitle>
        <CardDescription>
          Aggregates your completed Teach-Back and Historical Stress-Test scores into a
          tamper-evident, independently checkable link.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {isGuest ? (
          <div className="rounded-2xl border border-border bg-muted/45 p-7 text-center space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto">
              <Lock className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-extrabold text-foreground">
                Sign in with Google to generate your verified, shareable credential
              </p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                You&apos;re currently in a throwaway Guest session. Sign in with Google or Email as
                a Trader to save your NISM scores, mint a tamper-evident `/verify/:credentialId`
                link, and optionally opt in to employer matches.
              </p>
            </div>
            {onRequestSignIn && (
              <Button type="button" size="lg" onClick={onRequestSignIn}>
                <ShieldCheck className="h-4 w-4" /> Sign in with Google
              </Button>
            )}
          </div>
        ) : loading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="lg" label="Loading your verified credential..." />
          </div>
        ) : (
          <>
            {error && <ErrorBanner message={error} onRetry={loadCredential} />}

            {credential ? (
              <>
                {/* Summary Bar */}
                <div className="rounded-2xl border border-border bg-muted/45 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Public Credential ID
                    </div>
                    <div className="text-lg font-extrabold font-mono text-foreground">
                      {credential.credentialId}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      HMAC-SHA256: {String(credential.verificationHash || "").slice(0, 20)}...
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Overall Score
                    </div>
                    <div className="text-3xl font-extrabold font-mono text-brand-600 dark:text-brand-400">
                      {credential.overall_score}
                      <span className="text-sm font-normal text-muted-foreground"> / 100</span>
                    </div>
                  </div>
                </div>

                {/* Discoverability Privacy Toggle (Opt-in, default OFF) */}
                <div className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {credential.discoverable ? (
                        <Eye className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-bold text-foreground">
                        Employer Discoverability:{" "}
                        {credential.discoverable ? "Opted In" : "Private (Off)"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Opt in to appear in employer skill-match searches — off by default so your
                      scores stay private until you choose to share them.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={credential.discoverable ? "outline" : "default"}
                    size="sm"
                    disabled={toggling}
                    onClick={handleToggleDiscoverable}
                    className="shrink-0"
                  >
                    {toggling ? (
                      <Spinner size="sm" label="Updating..." />
                    ) : credential.discoverable ? (
                      "Set Private (Opt Out)"
                    ) : (
                      "Opt In to Employer Matches"
                    )}
                  </Button>
                </div>

                {/* Verified Concept List */}
                <div className="space-y-2.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Verified Concepts ({credential.concepts?.length || 0})
                  </div>
                  <div className="space-y-2">
                    {(credential.concepts || []).map((c) => (
                      <div
                        key={c.name}
                        className="rounded-xl border border-border bg-card px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-sm font-bold text-foreground">{c.name}</div>
                          <div className="text-[11px] font-mono text-muted-foreground">
                            Verified {new Date(c.last_verified).toLocaleDateString("en-IN")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="default" className="font-mono">
                            Teach-Back: {c.teachback_score}
                          </Badge>
                          <Badge variant="secondary" className="font-mono">
                            Stress-Test: {c.stress_score ?? "—"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Shareable Link Actions */}
                <div className="flex items-center gap-2.5 flex-wrap pt-1">
                  <Button type="button" onClick={handleCopyLink}>
                    <Copy className="h-4 w-4" /> Copy Shareable Link
                  </Button>
                  <a
                    href={`/verify/${credential.credentialId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex"
                  >
                    <Button type="button" variant="outline">
                      <ExternalLink className="h-4 w-4" /> Open Public Verification Page
                    </Button>
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={generating}
                    onClick={handleGenerate}
                  >
                    {generating ? (
                      <Spinner size="sm" label="Refreshing..." />
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" /> Refresh Scores
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-4">
                <Award className="h-8 w-8 text-brand-600 dark:text-brand-400 mx-auto" />
                <div className="space-y-1">
                  <p className="font-bold text-foreground">No credential generated yet</p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Complete at least one NISM Teach-Back verification, then generate your signed
                    credential below. Re-running later keeps the same public link and updates your
                    scores.
                  </p>
                </div>
                <Button type="button" size="lg" disabled={generating} onClick={handleGenerate}>
                  {generating ? (
                    <Spinner size="sm" label="Signing credential..." className="text-white" />
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" /> Generate Verified Credential
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <CardFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to Verification Flow
        </Button>
        <span className="text-xs font-mono text-muted-foreground">
          Signed with HMAC-SHA256 · Zero Blockchain Required
        </span>
      </CardFooter>
    </Card>
  );
}
