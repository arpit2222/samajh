"use client";

import React, { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  KeyRound,
  Copy,
  Check,
  AlertTriangle,
  ArrowLeft,
  Terminal,
  Trash2,
  X,
  Sun,
  Moon,
  Lock,
  Plus,
  Cpu,
} from "lucide-react";
import { subscribeToAuth } from "../../lib/firebase.js";
import {
  getApiBaseUrl,
  setApiUser,
  listDeveloperApiKeys,
  createDeveloperApiKey,
  revokeDeveloperApiKey,
} from "../../api.js";
import { Button } from "../../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Badge } from "../../components/ui/badge.jsx";
import { Spinner } from "../../components/ui/spinner.jsx";
import { ErrorBanner } from "../../components/ui/error-banner.jsx";

function formatMaskedKey(keyPrefix = "") {
  const suffix = keyPrefix.startsWith("sk_live_") ? keyPrefix.slice(8) : keyPrefix.slice(-4);
  return `sk_live_••••••••${suffix || "••••"}`;
}

function formatDate(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SnippetBox({ title, badge, code }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(`Copied ${title}`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy snippet");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">{title}</span>
          {badge && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              {badge}
            </Badge>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-4 text-xs font-mono text-slate-100 bg-slate-950 overflow-x-auto leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

export default function DeveloperPage() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null); // shown ONCE in dismissible banner
  const [snippetKey, setSnippetKey] = useState(null); // held in memory for snippets during this page visit only
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);
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

  useEffect(() => {
    const unsubscribe = subscribeToAuth((fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        setApiUser(fbUser);
      } else {
        setUser(null);
        setApiUser(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  async function loadKeys() {
    setLoading(true);
    setError("");
    try {
      const res = await listDeveloperApiKeys();
      setKeys(res.keys || []);
    } catch (err) {
      setError(err.message || "Could not load your API keys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setLoading(false);
      return;
    }
    loadKeys();
  }, [authReady, user?.uid]);

  async function handleCreateKey(e) {
    e?.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await createDeveloperApiKey({ label: label.trim() || undefined });
      setNewlyCreatedKey(res);
      setSnippetKey(res.key);
      setLabel("");
      toast.success("API key generated — copy it now");
      await loadKeys();
    } catch (err) {
      setError(err.message || "Could not generate API key.");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setError("");
    setRevoking(true);
    try {
      await revokeDeveloperApiKey(revokeTarget.id);
      toast.success(`Revoked "${revokeTarget.label}"`);
      setRevokeTarget(null);
      await loadKeys();
    } catch (err) {
      setError(err.message || "Could not revoke API key.");
    } finally {
      setRevoking(false);
    }
  }

  async function copyPlaintextKey(value) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("API key copied to clipboard");
    } catch {
      toast.error("Could not copy API key");
    }
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const apiBase = getApiBaseUrl();
  const displayKeyForSnippets = snippetKey || "sk_live_YOUR_API_KEY";

  const curlVerifyUnderstanding = `curl -X POST "${apiBase}/api/public/v1/verify-understanding" \\
  -H "Authorization: Bearer ${displayKeyForSnippets}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "concept": "Mark-to-Market (MTM) Margin in NSE equity futures",
    "explanation": "Open futures positions are settled daily in cash against the closing settlement price, so losses reduce margin immediately and can trigger a margin call or forced square-off before expiry."
  }'`;

  const curlVerifyCredential = `curl -X GET "${apiBase}/api/public/v1/verify-credential/smj-example01" \\
  -H "Authorization: Bearer ${displayKeyForSnippets}"`;

  const curlDiagnoseTrades = `curl -X POST "${apiBase}/api/public/v1/diagnose-trade-patterns" \\
  -H "Authorization: Bearer ${displayKeyForSnippets}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "ratios": { "fno_pct": 80, "overnight_pct": 60, "expiry_day_pct": 40, "total_trades": 5 },
    "risk_tags": ["high overnight exposure", "expiry-day options exposure"],
    "trade": {
      "date": "2025-03-10",
      "instrument_type": "Futures",
      "segment": "F&O",
      "direction": "BUY",
      "holding_bucket": "Overnight",
      "outcome_bucket": "loss",
      "expiry_day": false,
      "had_stop_loss": true
    },
    "note": "Held overnight assuming stop-loss would guarantee my exit price"
  }'`;

  const mcpClientConfig = JSON.stringify(
    {
      mcpServers: {
        samajh: {
          url: `${apiBase}/mcp`,
          headers: {
            Authorization: `Bearer ${displayKeyForSnippets}`,
          },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="min-h-dvh py-6 sm:py-10 px-4 sm:px-6">
      <Toaster richColors position="top-center" theme={darkMode ? "dark" : "light"} />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Bar */}
        <header className="flex items-center justify-between gap-3 pb-5 border-b border-border/80 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-600 via-indigo-600 to-emerald-500 flex items-center justify-center font-extrabold text-lg text-white">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold font-heading text-foreground">
                  Samajh Developer Platform
                </span>
                <Badge variant="default" className="text-[10px]">
                  REST v1 + MCP
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                API keys, Public REST endpoints, and Streamable HTTP MCP integration
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a href="/">
              <Button type="button" variant="outline" size="sm">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to App
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
        </header>

        {!authReady ? (
          <Card>
            <CardContent className="py-16 flex justify-center">
              <Spinner size="lg" label="Checking authentication..." />
            </CardContent>
          </Card>
        ) : !user ? (
          <Card>
            <CardContent className="py-14 text-center space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto">
                <Lock className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-extrabold text-foreground">
                  Sign in to manage Developer API keys
                </h1>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Authenticate with Google or Email on the main Samajh screen to generate API keys
                  for the Public REST API and MCP server.
                </p>
              </div>
              <a href="/">
                <Button type="button" size="lg">
                  Sign in on Samajh
                </Button>
              </a>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* One-Time Plaintext Key Reveal Banner */}
            {newlyCreatedKey && (
              <Card className="border-amber-300 dark:border-amber-500/50 bg-amber-50/80 dark:bg-amber-500/10">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-sm font-extrabold text-amber-950 dark:text-amber-100">
                          Copy your new API key now — it will never be shown again.
                        </p>
                        <p className="text-xs text-amber-900/85 dark:text-amber-200/85">
                          Samajh stores only a SHA-256 hash. Once you dismiss this banner or leave
                          this page, only the masked prefix remains visible.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setNewlyCreatedKey(null)}
                      aria-label="Dismiss key banner"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <code className="flex-1 rounded-xl bg-slate-950 text-emerald-300 border border-slate-800 px-3.5 py-2.5 text-xs font-mono break-all">
                      {newlyCreatedKey.key}
                    </code>
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => copyPlaintextKey(newlyCreatedKey.key)}
                      className="shrink-0"
                    >
                      <Copy className="h-4 w-4" /> Copy Key
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* API Keys Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge variant="default">
                    <KeyRound className="h-3.5 w-3.5" /> API Keys
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {activeKeys.length} active · {keys.length} total
                  </Badge>
                </div>
                <CardTitle className="pt-1">Developer &amp; Integrations</CardTitle>
                <CardDescription>
                  Use your API key to call Samajh&apos;s understanding verifier, credential checker,
                  and risk-pattern diagnoser via REST or connect any MCP client directly.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                {error && <ErrorBanner message={error} onRetry={loadKeys} />}

                {loading ? (
                  <div className="py-12 flex justify-center">
                    <Spinner size="lg" label="Loading your API keys..." />
                  </div>
                ) : keys.length === 0 ? (
                  /* Empty State */
                  <div className="rounded-2xl border border-dashed border-border bg-muted/35 p-8 text-center space-y-4">
                    <div className="h-12 w-12 rounded-2xl bg-brand-50 dark:bg-brand-500/15 border border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 mx-auto">
                      <KeyRound className="h-6 w-6" />
                    </div>
                    <div className="space-y-1 max-w-md mx-auto">
                      <p className="text-base font-bold text-foreground">No API keys yet</p>
                      <p className="text-sm text-muted-foreground">
                        Generate an API key to call Samajh&apos;s REST v1 endpoints from your
                        platform or connect an AI agent directly to Samajh&apos;s MCP server.
                      </p>
                    </div>
                    <form
                      onSubmit={handleCreateKey}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 max-w-md mx-auto"
                    >
                      <Input
                        placeholder="Optional label (e.g. Broker Safeguard)"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        disabled={creating}
                      />
                      <Button type="submit" size="lg" disabled={creating} className="shrink-0">
                        {creating ? (
                          <Spinner size="sm" label="Generating..." className="text-white" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4" /> Generate your first API key
                          </>
                        )}
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    {/* Create Additional Key Form */}
                    <form
                      onSubmit={handleCreateKey}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                    >
                      <Input
                        placeholder="Key label (optional, e.g. Production Agent)"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        disabled={creating}
                        className="flex-1"
                      />
                      <Button type="submit" disabled={creating} className="shrink-0">
                        {creating ? (
                          <Spinner size="sm" label="Generating..." className="text-white" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4" /> Generate New Key
                          </>
                        )}
                      </Button>
                    </form>

                    {/* Key List Table */}
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-left text-xs sm:text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="py-3 px-4 font-bold">Label</th>
                            <th className="py-3 px-4 font-bold">Key</th>
                            <th className="py-3 px-4 font-bold">Created</th>
                            <th className="py-3 px-4 font-bold">Last Used</th>
                            <th className="py-3 px-4 font-bold text-right">Requests</th>
                            <th className="py-3 px-4 font-bold">Status</th>
                            <th className="py-3 px-4 font-bold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {keys.map((k) => {
                            const isRevoked = Boolean(k.revokedAt);
                            return (
                              <tr
                                key={k.id}
                                className={
                                  isRevoked
                                    ? "bg-muted/25 text-muted-foreground opacity-60"
                                    : "bg-card text-foreground"
                                }
                              >
                                <td className="py-3 px-4 font-semibold">{k.label}</td>
                                <td className="py-3 px-4 font-mono text-xs">
                                  {formatMaskedKey(k.keyPrefix)}
                                </td>
                                <td className="py-3 px-4 text-xs whitespace-nowrap">
                                  {formatDate(k.createdAt)}
                                </td>
                                <td className="py-3 px-4 text-xs whitespace-nowrap">
                                  {k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}
                                </td>
                                <td className="py-3 px-4 font-mono text-right">
                                  {k.requestCount ?? 0}
                                </td>
                                <td className="py-3 px-4">
                                  <Badge variant={isRevoked ? "secondary" : "success"}>
                                    {isRevoked ? "Revoked" : "Active"}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  {isRevoked ? (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setRevokeTarget(k)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-rose-500" /> Revoke
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Integration Snippets Panel — shown once at least one active key exists */}
            {activeKeys.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Badge variant="default">
                      <Terminal className="h-3.5 w-3.5" /> Integration Snippets
                    </Badge>
                    <Badge variant="success" className="font-mono text-[11px]">
                      <Cpu className="h-3 w-3" /> Streamable HTTP MCP + REST v1
                    </Badge>
                  </div>
                  <CardTitle className="pt-1">Connect Your Platform or AI Agent</CardTitle>
                  <CardDescription>
                    {snippetKey
                      ? "Your newly generated key is pre-filled below for this session."
                      : "Replace sk_live_YOUR_API_KEY with your saved plaintext key."}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <SnippetBox
                    title="MCP Client Config (mcpServers)"
                    badge="Streamable HTTP · Bearer Auth"
                    code={mcpClientConfig}
                  />
                  <SnippetBox
                    title="1. Verify Understanding"
                    badge="POST /api/public/v1/verify-understanding"
                    code={curlVerifyUnderstanding}
                  />
                  <SnippetBox
                    title="2. Verify Credential"
                    badge="GET /api/public/v1/verify-credential/:credentialId"
                    code={curlVerifyCredential}
                  />
                  <SnippetBox
                    title="3. Diagnose Trade Patterns"
                    badge="POST /api/public/v1/diagnose-trade-patterns"
                    code={curlDiagnoseTrades}
                  />
                </CardContent>

                <CardFooter className="text-xs text-muted-foreground">
                  <span>All REST v1 and MCP tools share the exact same backend capability functions.</span>
                  <span className="font-mono">Auth: Authorization: Bearer sk_live_...</span>
                </CardFooter>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Revoke Confirmation Modal */}
      {revokeTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
                <CardTitle className="text-lg">Revoke API Key?</CardTitle>
              </div>
              <CardDescription>
                Are you sure you want to revoke{" "}
                <strong className="text-foreground">{revokeTarget.label}</strong> (
                <code className="font-mono">{formatMaskedKey(revokeTarget.keyPrefix)}</code>)?{" "}
                <strong className="text-rose-600 dark:text-rose-400">
                  Any integration or MCP client using this key will break immediately.
                </strong>
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={revoking}
                onClick={() => setRevokeTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={revoking}
                onClick={handleConfirmRevoke}
              >
                {revoking ? (
                  <Spinner size="sm" label="Revoking..." className="text-white" />
                ) : (
                  "Yes, Revoke Immediately"
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
