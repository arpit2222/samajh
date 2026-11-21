"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ShieldCheck,
  Upload,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Lock,
  Sparkles,
  Link2,
  CheckCircle2,
  BookOpen,
  RefreshCw,
  Unlink,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseAndRedactTradebookCsv,
  SAMPLE_BROKER_CSV,
} from "../lib/tradebookParser.js";
import {
  connectAngelSmartApi,
  disconnectAngel,
  disconnectKite,
  exchangeKiteRequestToken,
  fetchAngelStatus,
  fetchKiteLoginUrl,
  fetchKiteStatus,
  reviewPastTrade,
  startTeachBackFromConceptTag,
  syncAngelTrades,
  syncKiteTrades,
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
import { Input } from "../components/ui/input.jsx";
import { Textarea } from "../components/ui/textarea.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";

/**
 * Privacy-First Trade Profiler:
 * - Screen A (TradeProfileUpload): Zerodha Console / Angel One CSV upload + strict
 *   client-side redaction + static Option 2 broker OAuth roadmap card.
 * - Screen B (TradeProfileDashboard): Anonymized stat cards, bucketed past trades
 *   (zero ₹ amounts, zero PII), structural risk diagnosis, and direct loop-back into
 *   socraticAgent (skipping ingestAgent/conceptAgent).
 */
export default function TraderProfiler({ onJumpToTeachBack, onBack }) {
  const [parsed, setParsed] = useState(null);
  const [selectedTradeId, setSelectedTradeId] = useState(null);
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [launchingTeachBack, setLaunchingTeachBack] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState(null);
  const [error, setError] = useState("");

  // Zerodha Kite Connect (Read-Only) state
  const [kiteStatus, setKiteStatus] = useState(null);
  const [kiteLoading, setKiteLoading] = useState(true);
  const [kiteBusy, setKiteBusy] = useState(false);
  const [kiteError, setKiteError] = useState("");

  // Angel One SmartAPI (Read-Only TOTP) state
  const [angelStatus, setAngelStatus] = useState(null);
  const [angelLoading, setAngelLoading] = useState(true);
  const [angelBusy, setAngelBusy] = useState(false);
  const [angelError, setAngelError] = useState("");
  const [showAngelForm, setShowAngelForm] = useState(false);
  const [angelClientCode, setAngelClientCode] = useState("");
  const [angelPin, setAngelPin] = useState("");
  const [angelTotp, setAngelTotp] = useState("");

  const fileInputRef = useRef(null);

  const loadAngelStatus = useCallback(async () => {
    setAngelLoading(true);
    try {
      const status = await fetchAngelStatus();
      setAngelStatus(status);
    } catch {
      setAngelStatus({ configured: false, connected: false, scope: "read_only" });
    } finally {
      setAngelLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAngelStatus();
  }, [loadAngelStatus]);

  async function handleConnectAngel(e) {
    e.preventDefault();
    setAngelError("");
    setAngelBusy(true);
    try {
      await connectAngelSmartApi({
        clientcode: angelClientCode.trim(),
        password: angelPin.trim(),
        totp: angelTotp.trim(),
      });
      // Immediately wipe sensitive inputs from React state
      setAngelClientCode("");
      setAngelPin("");
      setAngelTotp("");
      setShowAngelForm(false);
      toast.success("Angel One SmartAPI connected (read-only, encrypted token stored)");
      await loadAngelStatus();
    } catch (err) {
      setAngelError(err.message || "Could not connect Angel One SmartAPI.");
    } finally {
      setAngelBusy(false);
    }
  }

  async function handleSyncAngel() {
    setAngelError("");
    setError("");
    setDiagnosisResult(null);
    setAngelBusy(true);
    try {
      const anonymized = await syncAngelTrades();
      setParsed(anonymized);
      setSelectedTradeId(anonymized.trades[0]?.id || null);
      toast.success(
        `Synced & anonymized ${anonymized.trades.length} trades from Angel One SmartAPI (read-only)`
      );
      await loadAngelStatus();
    } catch (err) {
      if (err.needsReconnect) {
        setAngelStatus((prev) => ({ ...(prev || {}), needs_reconnect: true }));
      }
      setAngelError(err.message || "Could not sync Angel One SmartAPI trades.");
    } finally {
      setAngelBusy(false);
    }
  }

  async function handleDisconnectAngel() {
    setAngelError("");
    setAngelBusy(true);
    try {
      await disconnectAngel();
      setAngelStatus((prev) => ({
        ...(prev || {}),
        connected: false,
        needs_reconnect: false,
        connected_at: null,
        expires_at: null,
        last_synced_at: null,
      }));
      toast.info("Angel One SmartAPI disconnected and encrypted token deleted immediately");
    } catch (err) {
      setAngelError(err.message || "Could not disconnect Angel One SmartAPI.");
    } finally {
      setAngelBusy(false);
    }
  }

  const loadKiteStatus = useCallback(async () => {
    setKiteLoading(true);
    try {
      const status = await fetchKiteStatus();
      setKiteStatus(status);
    } catch {
      setKiteStatus({ configured: false, connected: false, scope: "read_only" });
    } finally {
      setKiteLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initKite() {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const requestToken = params.get("request_token");
        const statusParam = params.get("status");
        if (requestToken && (!statusParam || statusParam === "success")) {
          setKiteBusy(true);
          setKiteError("");
          try {
            await exchangeKiteRequestToken(requestToken);
            if (active) {
              toast.success("Zerodha Kite connected (read-only, encrypted token stored)");
            }
          } catch (err) {
            if (active) {
              setKiteError(err.message || "Could not complete Zerodha Kite token exchange.");
            }
          } finally {
            // Strip single-use request_token from browser URL immediately
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, "", cleanUrl);
            if (active) setKiteBusy(false);
          }
        }
      }
      if (active) await loadKiteStatus();
    }
    initKite();
    return () => {
      active = false;
    };
  }, [loadKiteStatus]);

  async function handleConnectZerodha() {
    setKiteError("");
    setKiteBusy(true);
    try {
      const { login_url } = await fetchKiteLoginUrl();
      window.location.href = login_url;
    } catch (err) {
      setKiteError(err.message || "Could not start Zerodha Kite OAuth login.");
      setKiteBusy(false);
    }
  }

  async function handleSyncZerodha() {
    setKiteError("");
    setError("");
    setDiagnosisResult(null);
    setKiteBusy(true);
    try {
      const anonymized = await syncKiteTrades();
      setParsed(anonymized);
      setSelectedTradeId(anonymized.trades[0]?.id || null);
      toast.success(
        `Synced & anonymized ${anonymized.trades.length} trades from Zerodha Kite (read-only)`
      );
      await loadKiteStatus();
    } catch (err) {
      if (err.needsReconnect) {
        setKiteStatus((prev) => ({ ...(prev || {}), needs_reconnect: true }));
      }
      setKiteError(err.message || "Could not sync Zerodha Kite trades.");
    } finally {
      setKiteBusy(false);
    }
  }

  async function handleDisconnectZerodha() {
    setKiteError("");
    setKiteBusy(true);
    try {
      await disconnectKite();
      setKiteStatus((prev) => ({
        ...(prev || {}),
        connected: false,
        needs_reconnect: false,
        connected_at: null,
        expires_at: null,
        last_synced_at: null,
      }));
      toast.info("Zerodha Kite disconnected and encrypted token deleted immediately");
    } catch (err) {
      setKiteError(err.message || "Could not disconnect Zerodha Kite.");
    } finally {
      setKiteBusy(false);
    }
  }

  function processCsvText(csvText, label = "Tradebook") {
    setError("");
    setDiagnosisResult(null);
    try {
      const result = parseAndRedactTradebookCsv(csvText);
      setParsed(result);
      setSelectedTradeId(result.trades[0]?.id || null);
      toast.success(
        `${label} anonymized locally — stripped ${result.redactedFields.length} confidential fields`
      );
    } catch (err) {
      setParsed(null);
      setError(err.message || "Unrecognized CSV format.");
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => processCsvText(String(reader.result || ""), file.name);
    reader.onerror = () => setError("Could not read CSV file.");
    reader.readAsText(file);
  }

  const selectedTrade = parsed?.trades?.find((t) => t.id === selectedTradeId) || null;

  async function handleAnalyzeTrade() {
    if (!selectedTrade || !parsed) return;
    setError("");
    setReviewing(true);
    setDiagnosisResult(null);
    try {
      // Strictly strip internal UI id before sending; payload has zero PII / zero ₹ amounts
      const { id: _ignored, ...anonymizedTrade } = selectedTrade;
      const res = await reviewPastTrade({
        ratios: parsed.ratios,
        risk_tags: parsed.risk_tags,
        trade: anonymizedTrade,
        note: note.trim(),
      });
      setDiagnosisResult(res);
      toast.success("Structural risk diagnosis ready");
    } catch (err) {
      setError(err.message || "Could not diagnose trade. Please try again.");
    } finally {
      setReviewing(false);
    }
  }

  async function handleVerifyConceptNow() {
    if (!diagnosisResult?.concept_tag) return;
    setError("");
    setLaunchingTeachBack(true);
    try {
      const seeded = await startTeachBackFromConceptTag({
        concept_tag: diagnosisResult.concept_tag,
      });
      onJumpToTeachBack(seeded);
    } catch (err) {
      setError(err.message || "Could not start teach-back session. Please try again.");
    } finally {
      setLaunchingTeachBack(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* TradeProfileUpload (before CSV parsed) OR TradeProfileDashboard (after CSV parsed) */}
      {!parsed ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Badge variant="default">
                <FileSpreadsheet className="h-3.5 w-3.5" /> TradeProfileUpload
              </Badge>
              <Badge variant="success">
                <Lock className="h-3 w-3" /> 100% Client-Side Anonymization
              </Badge>
            </div>
            <CardTitle className="pt-1">Upload Zerodha or Angel One Tradebook CSV</CardTitle>
            <CardDescription>
              Parsed and anonymized <strong className="text-foreground">entirely in your browser</strong>.
              Client ID, PAN, Order ID, Trade ID, symbols, and all ₹ figures are stripped before any
              network call — the raw file is never uploaded.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="rounded-2xl border-2 border-dashed border-border bg-muted/35 p-8 text-center space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-base font-bold text-foreground">
                  Auto-detects Zerodha Console &amp; Angel One CSV exports
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Only derived ratios (F&amp;O %, Overnight %, Expiry-Day %) and anonymized trade
                  buckets ever leave your browser.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Upload Tradebook CSV
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => processCsvText(SAMPLE_BROKER_CSV, "Sample Zerodha CSV")}
                >
                  <Sparkles className="h-4 w-4" /> Load Sample Tradebook
                </Button>
              </div>
            </div>

            {error && (
              <ErrorBanner
                message={error}
                onRetry={() => {
                  setError("");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                retryLabel="Clear"
              />
            )}
          </CardContent>

          <CardFooter>
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back to Verification Flow
            </Button>
            <span className="text-xs font-mono text-muted-foreground">
              Raw CSV never leaves browser
            </span>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Badge variant="default">
                <FileSpreadsheet className="h-3.5 w-3.5" /> TradeProfileDashboard
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setParsed(null);
                  setDiagnosisResult(null);
                  setError("");
                }}
              >
                Upload Different CSV
              </Button>
            </div>
            <CardTitle className="pt-1">Anonymized Behavioral Risk Profile</CardTitle>
            <CardDescription>
              Select any anonymized past trade below to diagnose the structural risk mistake and jump
              straight into Teach-Back verification.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Local Privacy Receipt */}
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/35 bg-emerald-50/70 dark:bg-emerald-500/10 p-4 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs">
                <p className="font-bold text-emerald-950 dark:text-emerald-100">
                  Redacted locally in browser ({parsed.brokerSource})
                </p>
                <p className="text-emerald-900/85 dark:text-emerald-200/85">
                  <strong>Stripped:</strong> {parsed.redactedFields.join(", ")}.
                </p>
              </div>
            </div>

            {/* Stat-Card Row (reusing shared Card styling) */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4 text-center shadow-none">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  F&amp;O Trades
                </div>
                <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                  {parsed.ratios.fno_pct}%
                </div>
              </Card>
              <Card className="p-4 text-center shadow-none">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Overnight Holds
                </div>
                <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                  {parsed.ratios.overnight_pct}%
                </div>
              </Card>
              <Card className="p-4 text-center shadow-none">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Expiry-Day
                </div>
                <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
                  {parsed.ratios.expiry_day_pct}%
                </div>
              </Card>
            </div>

            {/* Risk Tags */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Risk Tags:</span>
              {parsed.risk_tags.map((tag) => (
                <Badge key={tag} variant="warning" className="text-xs capitalize">
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Anonymized Past Trades List (date, instrument_type, direction, holding_bucket, outcome_bucket ONLY) */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Anonymized Past Trades ({parsed.trades.length}) — Pick One To Diagnose
              </div>
              <div className="space-y-2">
                {parsed.trades.map((tr) => {
                  const isSelected = tr.id === selectedTradeId;
                  return (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => {
                        setSelectedTradeId(tr.id);
                        setDiagnosisResult(null);
                      }}
                      className={`w-full text-left rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all cursor-pointer ${
                        isSelected
                          ? "border-brand-600 bg-brand-50/80 dark:bg-brand-500/15 ring-1 ring-brand-500/30"
                          : "border-border bg-card hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">{tr.date}</span>
                        <Badge
                          variant={tr.direction === "SELL" ? "destructive" : "default"}
                          className="font-mono text-[10.5px]"
                        >
                          {tr.direction}
                        </Badge>
                        <span className="font-bold text-sm text-foreground">
                          {tr.instrument_type}
                        </span>
                        <Badge variant="secondary" className="text-[10.5px]">
                          {tr.holding_bucket}
                        </Badge>
                        {tr.expiry_day && (
                          <Badge variant="warning" className="text-[10.5px]">
                            Expiry Day
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            tr.outcome_bucket === "loss"
                              ? "destructive"
                              : tr.outcome_bucket === "gain"
                                ? "success"
                                : "secondary"
                          }
                          className="font-mono uppercase text-[10.5px]"
                        >
                          {tr.outcome_bucket}
                        </Badge>
                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Note + Diagnose CTA */}
            {selectedTrade && (
              <div className="rounded-2xl border border-border bg-muted/35 p-4 space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">
                  Optional note (do not include PAN or ₹ amounts)
                </label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="min-h-[68px]"
                  placeholder="e.g., Held overnight assuming my stop-loss order would cap downside at open..."
                  disabled={reviewing}
                />
                <div className="flex justify-end">
                  <Button type="button" onClick={handleAnalyzeTrade} disabled={reviewing}>
                    {reviewing ? (
                      <Spinner
                        size="sm"
                        label="Diagnosing structural mistake..."
                        className="text-white"
                      />
                    ) : (
                      <>
                        Diagnose Structural Mistake <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {error && <ErrorBanner message={error} onRetry={handleAnalyzeTrade} />}

            {/* Structural Diagnosis Result + Direct Loop-Back into socraticAgent */}
            {diagnosisResult && (
              <div className="rounded-2xl border border-rose-200 dark:border-rose-500/40 bg-card p-5 space-y-4 shadow-sm animate-screen-in">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3.5 w-3.5" /> Structural Risk Diagnosis
                  </Badge>
                  <Badge variant="default" className="font-mono text-[11px]">
                    {diagnosisResult.concept_tag}
                  </Badge>
                </div>

                <p className="text-sm sm:text-[15px] text-foreground leading-relaxed">
                  {diagnosisResult.diagnosis}
                </p>

                <div className="rounded-xl border border-border bg-muted/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                      Concept Gap: {diagnosisResult.concept_name}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Jumps straight into a live 3-turn Teach-Back on this exact concept.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="emerald"
                    disabled={launchingTeachBack}
                    onClick={handleVerifyConceptNow}
                    className="shrink-0"
                  >
                    {launchingTeachBack ? (
                      <Spinner size="sm" label="Starting Teach-Back..." />
                    ) : (
                      <>
                        Verify this concept now <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter>
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Back to Verification Flow
            </Button>
            <span className="text-xs font-mono text-muted-foreground">
              Risk-literacy diagnosis only · Never investment advice
            </span>
          </CardFooter>
        </Card>
      )}

      {/* Option 2: Direct Read-Only Broker Sync (Zerodha Kite Connect LIVE + Angel One Roadmap) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="default">
              <Link2 className="h-3.5 w-3.5" /> Direct Broker Sync
            </Badge>
            <Badge variant="success" className="text-[10.5px]">
              <Lock className="h-3 w-3" /> Read-Only · Encrypted Token · Identical Anonymization
            </Badge>
          </div>
          <CardTitle className="text-lg">Read-Only Broker Integrations (Zerodha Kite &amp; Angel One SmartAPI)</CardTitle>
          <CardDescription>
            Optional alternatives to manual CSV upload. No broker passwords or PINs are ever stored,
            no trading/write permissions are requested, and live data runs through the exact same
            anonymization pipeline as CSV uploads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Zerodha Kite Connect — Live Read-Only Integration */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-sm text-foreground">Zerodha Kite Connect</span>
                {kiteLoading ? (
                  <Badge variant="secondary" className="text-[10px]">Checking...</Badge>
                ) : kiteStatus?.connected && kiteStatus?.needs_reconnect ? (
                  <Badge variant="warning" className="text-[10px]">Session Expired</Badge>
                ) : kiteStatus?.connected ? (
                  <Badge variant="success" className="text-[10px]">Connected (Read-Only)</Badge>
                ) : (
                  <Badge variant="default" className="text-[10px]">Read-Only OAuth</Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Pulls read-only trades, orders &amp; holdings, encrypts the session token with
                AES-256-GCM, and strips all symbols, IDs, and ₹ figures before any agent sees it.
              </p>

              {kiteError && <ErrorBanner message={kiteError} />}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                {!kiteStatus?.connected || kiteStatus?.needs_reconnect ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={kiteBusy || kiteLoading}
                    onClick={handleConnectZerodha}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {kiteBusy
                      ? "Connecting..."
                      : kiteStatus?.needs_reconnect
                        ? "Reconnect Zerodha"
                        : "Connect Zerodha"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={kiteBusy}
                    onClick={handleSyncZerodha}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${kiteBusy ? "animate-spin" : ""}`} />
                    {kiteBusy ? "Syncing..." : "Sync & Anonymize Trades"}
                  </Button>
                )}

                {kiteStatus?.connected && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={kiteBusy}
                    onClick={handleDisconnectZerodha}
                  >
                    <Unlink className="h-3.5 w-3.5" /> Disconnect
                  </Button>
                )}
              </div>

              {!kiteLoading && kiteStatus && !kiteStatus.configured && (
                <p className="text-[11px] text-muted-foreground">
                  Early Access: Live Kite OAuth activates once broker app approval is connected —
                  use 100% private CSV upload above today.
                </p>
              )}
            </div>

            {/* Angel One SmartAPI — Live Read-Only TOTP Integration */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-sm text-foreground">Angel One SmartAPI</span>
                {angelLoading ? (
                  <Badge variant="secondary" className="text-[10px]">Checking...</Badge>
                ) : angelStatus?.connected && angelStatus?.needs_reconnect ? (
                  <Badge variant="warning" className="text-[10px]">Session Expired</Badge>
                ) : angelStatus?.connected ? (
                  <Badge variant="success" className="text-[10px]">Connected (Read-Only)</Badge>
                ) : (
                  <Badge variant="default" className="text-[10px]">Read-Only TOTP</Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Uses official SmartAPI TOTP auth, encrypts only the session JWT with AES-256-GCM
                (never stores MPIN/TOTP), and anonymizes identically to CSV uploads.
              </p>

              {angelError && <ErrorBanner message={angelError} />}

              {showAngelForm && (!angelStatus?.connected || angelStatus?.needs_reconnect) ? (
                <form onSubmit={handleConnectAngel} className="space-y-2.5 pt-1">
                  <Input
                    type="text"
                    placeholder="Angel One Client Code (never stored)"
                    value={angelClientCode}
                    onChange={(e) => setAngelClientCode(e.target.value)}
                    required
                    disabled={angelBusy}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="password"
                      placeholder="MPIN (never stored)"
                      value={angelPin}
                      onChange={(e) => setAngelPin(e.target.value)}
                      required
                      disabled={angelBusy}
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit TOTP"
                      value={angelTotp}
                      onChange={(e) => setAngelTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      disabled={angelBusy}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={angelBusy}>
                      {angelBusy ? "Connecting..." : "Authorize Read-Only"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={angelBusy}
                      onClick={() => {
                        setShowAngelForm(false);
                        setAngelPin("");
                        setAngelTotp("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  {!angelStatus?.connected || angelStatus?.needs_reconnect ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={angelBusy || angelLoading}
                      onClick={() => setShowAngelForm(true)}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {angelStatus?.needs_reconnect ? "Reconnect Angel One" : "Connect Angel One"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={angelBusy}
                      onClick={handleSyncAngel}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${angelBusy ? "animate-spin" : ""}`} />
                      {angelBusy ? "Syncing..." : "Sync & Anonymize Trades"}
                    </Button>
                  )}

                  {angelStatus?.connected && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={angelBusy}
                      onClick={handleDisconnectAngel}
                    >
                      <Unlink className="h-3.5 w-3.5" /> Disconnect
                    </Button>
                  )}
                </div>
              )}

              {!angelLoading && angelStatus && !angelStatus.configured && (
                <p className="text-[11px] text-muted-foreground">
                  Early Access: Live SmartAPI sync activates once broker API credentials are
                  connected — use 100% private CSV upload above today.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
