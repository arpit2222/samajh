"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldAlert,
  Award,
  Calendar,
  ArrowLeft,
  Lock,
  Link2,
  ExternalLink,
  Sun,
  Moon,
} from "lucide-react";
import { verifyPublicCredential, fetchCredentialOnchainStatus } from "../../../api.js";
import { Button } from "../../../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.jsx";
import { Badge } from "../../../components/ui/badge.jsx";
import { Spinner } from "../../../components/ui/spinner.jsx";
import { ErrorBanner } from "../../../components/ui/error-banner.jsx";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * PUBLIC verification page at /verify/:credentialId — NO login wall.
 * Primary proof: server-side HMAC-SHA256 signature verification (instant, always present).
 * Secondary proof: non-blocking Polygon Amoy Soulbound Token anchor with 30s polling cap.
 */
export default function PublicVerifyPage() {
  const params = useParams();
  const credentialId = Array.isArray(params?.credentialId)
    ? params.credentialId[0]
    : params?.credentialId;

  const [data, setData] = useState(null);
  const [onchain, setOnchain] = useState(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("samajh_theme") : null;
    if (saved === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  function toggleTheme() {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("samajh_theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("samajh_theme", "light");
      }
      return next;
    });
  }

  async function runVerification() {
    if (!credentialId) return;
    setLoading(true);
    setError("");
    setPollTimedOut(false);
    try {
      const res = await verifyPublicCredential(credentialId);
      setData(res);
      if (res?.credential) {
        setOnchain({
          onchain_status: res.credential.onchain_status || "unanchored",
          onchain_network: res.credential.onchain_network || "polygon-amoy",
          onchain_holder: res.credential.onchain_holder || null,
          txHash: res.credential.txHash || null,
          tokenId: res.credential.tokenId || null,
          explorerUrl: res.credential.explorerUrl || null,
        });
      }
    } catch (err) {
      setError(err.message || "Could not verify this credential ID.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runVerification();
  }, [credentialId]);

  // Non-blocking polling for Polygon Amoy SBT anchor when status is "pending"
  useEffect(() => {
    if (!credentialId || onchain?.onchain_status !== "pending") return;

    const startedAt = Date.now();
    let cancelled = false;

    const timer = setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        clearInterval(timer);
        setPollTimedOut(true);
        return;
      }
      try {
        const statusRes = await fetchCredentialOnchainStatus(credentialId);
        if (cancelled) return;
        setOnchain(statusRes);
        if (statusRes.onchain_status === "confirmed" || statusRes.onchain_status === "failed") {
          clearInterval(timer);
        }
      } catch {
        // Quietly keep trying until timeout; never break the verification page
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [credentialId, onchain?.onchain_status]);

  const cred = data?.credential;
  const isVerified = Boolean(data?.verified);
  const onchainStatus = onchain?.onchain_status || "unanchored";

  return (
    <div className="min-h-dvh py-8 sm:py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Public Header (no login required) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-600 via-indigo-600 to-emerald-500 flex items-center justify-center font-extrabold text-base text-white">
              S
            </div>
            <div>
              <div className="font-extrabold font-heading text-foreground leading-tight">
                Samajh Public Verifier
              </div>
              <div className="text-xs text-muted-foreground">
                Independent HMAC-SHA256 credential check · No sign-in required
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/">
              <Button type="button" variant="outline" size="sm">
                <ArrowLeft className="h-3.5 w-3.5" /> Open Samajh
              </Button>
            </a>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"}
            >
              {darkMode ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-slate-600" />
              )}
            </Button>
          </div>
        </div>

        <Card>
          {loading ? (
            <CardContent className="py-16 flex justify-center">
              <Spinner size="lg" label={`Verifying credential ${credentialId}...`} />
            </CardContent>
          ) : error ? (
            <CardContent className="py-8">
              <ErrorBanner message={error} onRetry={runVerification} />
            </CardContent>
          ) : cred ? (
            <>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge
                    variant={isVerified ? "success" : "destructive"}
                    className="text-xs py-1 px-3"
                  >
                    {isVerified ? (
                      <>
                        <ShieldCheck className="h-4 w-4" /> Cryptographically Verified
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4" /> Record Altered — Verification Failed
                      </>
                    )}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground">
                    ID: {cred.credentialId}
                  </span>
                </div>

                <CardTitle className="pt-2">{cred.displayName}</CardTitle>
                <CardDescription>
                  {isVerified
                    ? "Server-side HMAC-SHA256 signature matches stored Firestore scores. No tampering detected."
                    : "WARNING: This record's contents no longer match its server-side cryptographic signature."}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                {!isVerified && (
                  <div className="rounded-2xl border-2 border-rose-500 bg-rose-50 dark:bg-rose-500/15 p-5 flex items-start gap-3">
                    <ShieldAlert className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-extrabold text-rose-900 dark:text-rose-100">
                        This record has been altered
                      </p>
                      <p className="text-sm text-rose-800 dark:text-rose-200">
                        The recomputed HMAC-SHA256 hash does not match the signed digest stored when
                        Samajh issued this credential. Do not rely on these scores.
                      </p>
                    </div>
                  </div>
                )}

                {/* Overall Mastery Score */}
                <div className="rounded-2xl border border-border bg-muted/45 p-5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400">
                      <Award className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Overall Understanding Score
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Aggregated across {cred.concepts?.length || 0} verified NISM concepts
                      </div>
                    </div>
                  </div>
                  <div className="text-4xl font-extrabold font-mono text-foreground">
                    {cred.overall_score}
                    <span className="text-base font-normal text-muted-foreground"> / 100</span>
                  </div>
                </div>

                {/* Concept Breakdown */}
                <div className="space-y-2.5">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Verified Financial Mechanisms
                  </div>
                  {(cred.concepts || []).map((c) => (
                    <div
                      key={c.name}
                      className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="space-y-0.5">
                        <div className="text-sm font-bold text-foreground">{c.name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Verified {new Date(c.last_verified).toLocaleDateString("en-IN")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default" className="font-mono">
                          Teach-Back: {c.teachback_score}/100
                        </Badge>
                        <Badge variant="success" className="font-mono">
                          Stress-Test: {c.stress_score ?? "—"}/100
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Primary Signature Metadata */}
                <div className="rounded-xl border border-border bg-muted/35 p-3.5 text-xs font-mono text-muted-foreground break-all flex items-start gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>HMAC-SHA256 Digest: {cred.verificationHash}</span>
                </div>

                {/* Secondary Section: Non-Blocking Polygon Amoy Soulbound Token Anchor */}
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <Link2 className="h-3.5 w-3.5" /> On-Chain Anchor · Polygon Amoy (Soulbound)
                    </div>
                    {onchainStatus === "confirmed" ? (
                      <Badge variant="success" className="text-[11px]">
                        Anchored On-Chain
                      </Badge>
                    ) : onchainStatus === "pending" && !pollTimedOut ? (
                      <Badge variant="secondary" className="text-[11px]">
                        Pending Confirmation
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">
                        Firestore Primary
                      </Badge>
                    )}
                  </div>

                  {onchainStatus === "confirmed" && onchain?.txHash ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5 text-xs text-muted-foreground font-mono">
                        {onchain.tokenId && <div>Token ID: #{onchain.tokenId} (Non-transferable SBT)</div>}
                        <div>Tx: {onchain.txHash.slice(0, 18)}...{onchain.txHash.slice(-8)}</div>
                      </div>
                      <a
                        href={onchain.explorerUrl || `https://amoy.polygonscan.com/tx/${onchain.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex"
                      >
                        <Button type="button" size="sm" variant="outline">
                          <ExternalLink className="h-3.5 w-3.5" /> View on PolygonScan Amoy
                        </Button>
                      </a>
                    </div>
                  ) : onchainStatus === "pending" && !pollTimedOut ? (
                    <div className="py-1">
                      <Spinner size="sm" label="Anchoring on Polygon Amoy..." />
                    </div>
                  ) : (
                    <p className="text-xs sm:text-[13px] text-muted-foreground leading-relaxed">
                      On-chain anchor unavailable right now — the HMAC-SHA256 signature verification
                      above still holds.
                    </p>
                  )}
                </div>
              </CardContent>

              <CardFooter className="text-xs text-muted-foreground">
                <span>Issued by Samajh — Learn it. Prove it.</span>
                {cred.isSeedData && <Badge variant="secondary">Demo Seed Record</Badge>}
              </CardFooter>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
