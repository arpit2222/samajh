"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Flag,
  Lock,
  MessageSquareText,
  Send,
  ShieldAlert,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  fetchDiscussionThread,
  postToDiscussion,
  reportDiscussionPost,
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
import { Textarea } from "../components/ui/textarea.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";

const SUBTOPIC_OPTIONS = [
  {
    id: "overnight_gap_stoploss_risk",
    label: "Overnight Gap & Stop-Loss",
    hint: "Gap-down slippage & non-guaranteed SL execution",
  },
  {
    id: "circuit_breaker_margin_risk",
    label: "Circuit Breaker & MTM Margin",
    hint: "Lower circuits, illiquidity & forced broker square-offs",
  },
  {
    id: "event_volatility_option_writing_risk",
    label: "Event Volatility & Option Writing",
    hint: "Gamma/vega spikes around binary macro events",
  },
  {
    id: "regulatory_moratorium_liquidity_risk",
    label: "Moratorium & Liquidity Freeze",
    hint: "Collateral haircuts & counterparty risk",
  },
  {
    id: "general_market_risk",
    label: "General Market Risk",
    hint: "Position sizing & structural volatility mechanisms",
  },
];

function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function DiscussionCircle({
  initialSubtopic,
  sessionId,
  onStartPractice,
  onBack,
}) {
  const validInitial = SUBTOPIC_OPTIONS.some((s) => s.id === initialSubtopic)
    ? initialSubtopic
    : SUBTOPIC_OPTIONS[0].id;

  const [selectedSubtopic, setSelectedSubtopic] = useState(validInitial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");
  const [threadData, setThreadData] = useState(null);

  const [draftText, setDraftText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState("");
  const [reportingId, setReportingId] = useState(null);

  const loadThread = useCallback(
    async (subtopic, targetPage) => {
      setLoading(true);
      setError("");
      setLockedMessage("");
      try {
        const data = await fetchDiscussionThread({
          weak_subtopic: subtopic,
          page: targetPage,
          limit: 10,
          sessionId,
        });
        if (data?.locked) {
          setLockedMessage(data.error || "Attempt this subtopic first to unlock this circle.");
          setThreadData(null);
        } else {
          setThreadData(data);
        }
      } catch (err) {
        setError(err.message || "Could not load discussion circle.");
        setThreadData(null);
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    loadThread(selectedSubtopic, page);
  }, [selectedSubtopic, page, loadThread]);

  function handleSelectSubtopic(id) {
    setSelectedSubtopic(id);
    setPage(1);
    setPostError("");
  }

  async function handleSubmitPost(e) {
    e.preventDefault();
    const trimmed = draftText.trim();
    if (trimmed.length < 10) {
      setPostError("Write at least 10 characters explaining the risk pattern or mechanism.");
      return;
    }

    setSubmitting(true);
    setPostError("");
    try {
      await postToDiscussion({
        weak_subtopic: selectedSubtopic,
        text: trimmed,
        sessionId,
      });
      setDraftText("");
      toast.success("Posted to Discussion Circle");
      setPage(1);
      await loadThread(selectedSubtopic, 1);
    } catch (err) {
      setPostError(err.message || "Could not publish post.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportPost(postId) {
    setReportingId(postId);
    try {
      const res = await reportDiscussionPost({
        weak_subtopic: selectedSubtopic,
        postId,
      });
      setThreadData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          posts: (prev.posts || []).map((p) =>
            p.id === postId ? { ...p, ...res.post, flagged: true } : p
          ),
        };
      });
      toast.info("Post flagged for human moderation review");
    } catch (err) {
      toast.error(err.message || "Could not flag post");
    } finally {
      setReportingId(null);
    }
  }

  const activeMeta =
    SUBTOPIC_OPTIONS.find((s) => s.id === selectedSubtopic) || SUBTOPIC_OPTIONS[0];
  const posts = threadData?.posts || [];
  const totalPages = threadData?.total_pages || 1;
  const totalPosts = threadData?.total_posts ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <MessageSquareText className="h-3.5 w-3.5" /> Weak-Subtopic Discussion Circles
          </Badge>
          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" /> Pattern-Only · Zero PII / Tickers
          </Badge>
        </div>
        <CardTitle className="pt-1">Peer Concept Circles</CardTitle>
        <CardDescription>
          Discuss risk mechanics with learners working on the exact same gap. No stock tickers, no
          ₹ amounts, no file uploads — strictly pattern-level understanding.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Subtopic selector tabs */}
        <div className="flex flex-wrap gap-2">
          {SUBTOPIC_OPTIONS.map((opt) => {
            const active = opt.id === selectedSubtopic;
            return (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => handleSelectSubtopic(opt.id)}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>

        {/* Active subtopic context strip */}
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-mono text-muted-foreground">{activeMeta.id}</p>
            <p className="text-sm font-semibold text-foreground">{activeMeta.hint}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => loadThread(selectedSubtopic, page)}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <Spinner size="md" label="Loading discussion circle..." />
          </div>
        ) : lockedMessage ? (
          /* Gated locked state */
          <div className="rounded-2xl border border-amber-300/70 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/10 p-6 sm:p-8 text-center space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-amber-100 dark:bg-amber-500/20 border border-amber-300 dark:border-amber-500/40 mx-auto flex items-center justify-center text-amber-700 dark:text-amber-300">
              <Lock className="h-6 w-6" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h3 className="text-base font-bold text-foreground">
                Circle Locked — Attempt Required
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{lockedMessage}</p>
            </div>
            <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
              {onStartPractice && (
                <Button type="button" onClick={onStartPractice}>
                  Start Verification Flow
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </div>
          </div>
        ) : error ? (
          <ErrorBanner
            message={error}
            onRetry={() => loadThread(selectedSubtopic, page)}
            retryLabel="Retry"
          />
        ) : (
          <>
            {/* Text-only composer */}
            <form
              onSubmit={handleSubmitPost}
              className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label
                  htmlFor="discussion-post-input"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Share a Pattern-Level Insight (Text Only)
                </label>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {draftText.trim().length} / 1000
                </span>
              </div>

              <Textarea
                id="discussion-post-input"
                rows={3}
                maxLength={1000}
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  if (postError) setPostError("");
                }}
                placeholder="Example: What helped me understand gap-down slippage was separating trigger price from limit execution when overnight order books thin out..."
                disabled={submitting}
              />

              {postError && <ErrorBanner message={postError} />}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  Posts mentioning stock tickers, F&amp;O contracts, or ₹ amounts are automatically
                  rejected.
                </p>
                <Button type="submit" disabled={submitting || draftText.trim().length < 10}>
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "Posting..." : "Post Insight"}
                </Button>
              </div>
            </form>

            {/* Posts list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing <strong className="text-foreground">{posts.length}</strong> of{" "}
                  <strong className="text-foreground">{totalPosts}</strong> pattern notes
                </span>
                <span className="font-mono">
                  Page {page} of {totalPages}
                </span>
              </div>

              {posts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No pattern notes in this circle yet. Be the first to share what clicked for you on{" "}
                  <span className="font-semibold text-foreground">{activeMeta.label}</span>.
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => (
                    <div
                      key={post.id}
                      className="rounded-xl border border-border bg-card p-4 space-y-2.5 shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-foreground">
                            {post.author_label || "Anonymous Learner"}
                          </span>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {formatTimestamp(post.created_at)}
                          </span>
                          {post.flagged && (
                            <Badge variant="warning" className="text-[10px]">
                              <Flag className="h-3 w-3" /> Flagged for review
                            </Badge>
                          )}
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                          disabled={reportingId === post.id}
                          onClick={() => handleReportPost(post.id)}
                          title="Flag this post for human moderation review"
                        >
                          <Flag className="h-3.5 w-3.5" />
                          {reportingId === post.id
                            ? "Flagging..."
                            : post.flagged
                            ? "Reported"
                            : "Report post"}
                        </Button>
                      </div>

                      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                        {post.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <span className="text-xs font-mono text-muted-foreground">
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">
          Flagged posts remain visible pending human review — never auto-deleted.
        </span>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to Flow
        </Button>
      </CardFooter>
    </Card>
  );
}
