"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Send,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  User,
  Bot,
  RefreshCw,
  Mic,
  MicOff,
  Keyboard,
} from "lucide-react";
import { toast } from "sonner";
import { sendTeachBack, examineSession } from "../api.js";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Textarea } from "../components/ui/textarea.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";
import { Progress } from "../components/ui/progress.jsx";

const MAX_AGENT_TURNS = 3;

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="h-2 w-2 rounded-full bg-blue-500 typing-dot" />
      <span className="h-2 w-2 rounded-full bg-blue-500 typing-dot" />
      <span className="h-2 w-2 rounded-full bg-blue-500 typing-dot" />
    </span>
  );
}

export default function TeachBackChat({ sessionData, onExamined }) {
  const [turns, setTurns] = useState([]);
  const [agentTurns, setAgentTurns] = useState(0);
  const [done, setDone] = useState(false);
  const [userText, setUserText] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [sending, setSending] = useState(false);
  const [examining, setExamining] = useState(false);
  const [error, setError] = useState("");

  // Optional Voice Mode with mandatory, always-visible "Switch to typing" fallback
  const [inputMode, setInputMode] = useState("typing"); // "typing" | "voice"
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const initializedSessionRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      setVoiceSupported(Boolean(SpeechRec));
    }
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore cleanup error
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionData?.sessionId) return;
    if (initializedSessionRef.current === sessionData.sessionId) return;
    initializedSessionRef.current = sessionData.sessionId;

    let cancelled = false;
    async function startDialogue() {
      setInitializing(true);
      setError("");
      try {
        const res = await sendTeachBack({ sessionId: sessionData.sessionId });
        if (cancelled) return;
        if (res.reply) {
          setTurns([{ speaker: "agent", text: res.reply }]);
          setAgentTurns(1);
        }
        if (res.done) setDone(true);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Could not start teach-back conversation.");
          initializedSessionRef.current = null;
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    startDialogue();
    return () => {
      cancelled = true;
    };
  }, [sessionData?.sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, sending, initializing]);

  function stopVoiceListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    setListening(false);
  }

  function startVoiceListening() {
    if (typeof window === "undefined") return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      toast.error("Voice input isn't supported in this browser — switched to typing.");
      setInputMode("typing");
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = "en-IN";
      recognition.continuous = true;
      recognition.interimResults = true;

      let finalTranscript = userText ? `${userText.trim()} ` : "";
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += `${piece} `;
          } else {
            interim += piece;
          }
        }
        setUserText((finalTranscript + interim).trimStart());
      };

      recognition.onerror = (ev) => {
        setListening(false);
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          toast.error("Microphone permission blocked — switched to typing.");
          setInputMode("typing");
        } else {
          toast.info("Mic paused — you can edit or switch to typing anytime.");
        }
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setInputMode("typing");
      toast.error("Could not start microphone — switched to typing.");
    }
  }

  async function retryInit() {
    setInitializing(true);
    setError("");
    try {
      const res = await sendTeachBack({ sessionId: sessionData.sessionId });
      if (res.reply) {
        setTurns([{ speaker: "agent", text: res.reply }]);
        setAgentTurns(1);
      }
      if (res.done) setDone(true);
      initializedSessionRef.current = sessionData.sessionId;
    } catch (err) {
      setError(err.message || "Could not start teach-back conversation.");
    } finally {
      setInitializing(false);
    }
  }

  async function handleSend(e) {
    e?.preventDefault();
    stopVoiceListening();
    const trimmed = userText.trim();
    if (!trimmed || sending || initializing || done) return;

    setError("");
    setSending(true);
    setTurns((prev) => [...prev, { speaker: "user", text: trimmed }]);
    setUserText("");

    try {
      const res = await sendTeachBack({
        sessionId: sessionData.sessionId,
        userText: trimmed,
      });

      if (res.reply) {
        setTurns((prev) => [...prev, { speaker: "agent", text: res.reply }]);
        setAgentTurns((c) => c + 1);
      }
      if (res.done) {
        setDone(true);
      }
    } catch (err) {
      setTurns((prev) => prev.slice(0, -1));
      setUserText(trimmed);
      setError(err.message || "Failed to send response. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleExamine() {
    stopVoiceListening();
    setError("");
    setExamining(true);
    try {
      const result = await examineSession({ sessionId: sessionData.sessionId });
      onExamined(result);
    } catch (err) {
      setError(err.message || "Examiner failed to score your explanation. Please retry.");
    } finally {
      setExamining(false);
    }
  }

  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSend(e);
    }
  }

  const userRepliesSent = turns.filter((t) => t.speaker === "user").length;
  const progressPct = done ? 100 : Math.round((userRepliesSent / MAX_AGENT_TURNS) * 100);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <MessageSquare className="h-3.5 w-3.5" /> Step 3 · Teach-Back Dialogue
          </Badge>
          <div className="flex items-center gap-2">
            {voiceSupported && !done && (
              <Button
                type="button"
                size="sm"
                variant={inputMode === "voice" ? "default" : "outline"}
                onClick={() => {
                  if (inputMode === "voice") {
                    stopVoiceListening();
                    setInputMode("typing");
                  } else {
                    setInputMode("voice");
                  }
                }}
              >
                {inputMode === "voice" ? (
                  <>
                    <Keyboard className="h-3.5 w-3.5" /> Switch to Typing
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5" /> Voice Mode
                  </>
                )}
              </Button>
            )}
            <Badge variant={done ? "success" : "secondary"}>
              {done
                ? "3 / 3 Exchanges Complete"
                : `Novice Probe ${Math.min(agentTurns || 1, MAX_AGENT_TURNS)} of ${MAX_AGENT_TURNS}`}
            </Badge>
          </div>
        </div>
        <CardTitle className="pt-1">Correct the confused novice</CardTitle>
        <CardDescription>
          Spot the flaw in their restatement and explain <strong className="text-foreground">why</strong>{" "}
          in plain language. The Examiner scores only your turns.
        </CardDescription>

        <div className="pt-3 space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground font-medium">
            <span>Teach-back progress</span>
            <span className="font-mono">
              {userRepliesSent} / {MAX_AGENT_TURNS} replies
            </span>
          </div>
          <Progress
            value={progressPct}
            indicatorClassName={done ? "bg-emerald-500" : "bg-blue-600 dark:bg-blue-500"}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Chat Feed */}
        <div className="rounded-2xl border border-border bg-muted/45 p-4 sm:p-5 min-h-[270px] max-h-[430px] overflow-y-auto space-y-4">
          {initializing && turns.length === 0 && (
            <div className="flex flex-col items-center gap-2.5 text-sm text-muted-foreground py-12 justify-center">
              <TypingDots />
              <span>Confused novice is trying to restate your concept...</span>
            </div>
          )}

          {turns.map((turn, idx) => {
            const isUser = turn.speaker === "user";
            return (
              <div
                key={idx}
                className={`flex items-start gap-2.5 animate-screen-in ${
                  isUser ? "justify-end" : "justify-start"
                }`}
              >
                {!isUser && (
                  <div className="h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 mt-0.5 shadow-xs">
                    <Bot className="h-4 w-4" />
                  </div>
                )}

                <div
                  className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm sm:text-[15px] leading-relaxed ${
                    isUser
                      ? "bg-blue-600 text-white rounded-br-sm shadow-md shadow-blue-600/20"
                      : "bg-card border border-border text-foreground rounded-bl-sm shadow-xs"
                  }`}
                >
                  <div
                    className={`text-[10.5px] font-bold uppercase tracking-wider mb-1 ${
                      isUser ? "text-blue-100/90" : "text-muted-foreground"
                    }`}
                  >
                    {isUser ? "Your Explanation" : "Confused Novice"}
                  </div>
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>

                {isUser && (
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-600/25 border border-blue-300 dark:border-blue-500/40 flex items-center justify-center shrink-0 text-blue-700 dark:text-blue-300 mt-0.5">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}

          {sending && (
            <div className="flex items-start gap-2.5">
              <div className="h-8 w-8 rounded-full bg-card border border-border flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-card border border-border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2.5 shadow-xs">
                <TypingDots />
                <span className="text-xs font-medium">Probing your reasoning...</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer (Typing or Voice with always-visible typing fallback) */}
        {!done ? (
          <form onSubmit={handleSend} className="space-y-3">
            {inputMode === "voice" && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-500/35 bg-blue-50/70 dark:bg-blue-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={listening ? "destructive" : "default"}
                    onClick={listening ? stopVoiceListening : startVoiceListening}
                    disabled={sending || initializing}
                  >
                    {listening ? (
                      <>
                        <MicOff className="h-4 w-4" /> Stop Listening
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" /> Tap to Speak (en-IN)
                      </>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {listening
                      ? "Listening... live transcript appears below."
                      : "Speak your explanation or edit the text below."}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    stopVoiceListening();
                    setInputMode("typing");
                  }}
                >
                  <Keyboard className="h-3.5 w-3.5" /> Switch to Typing
                </Button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
              <Textarea
                value={userText}
                onChange={(e) => setUserText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending || initializing || turns.length === 0}
                rows={3}
                className="min-h-[86px] flex-1"
                placeholder="Point out what they got wrong and explain how the mechanism actually works... (⌘/Ctrl + Enter)"
              />
              <Button
                type="submit"
                size="lg"
                className="sm:h-12 shrink-0"
                disabled={sending || initializing || !userText.trim() || turns.length === 0}
              >
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-2xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/90 dark:bg-emerald-500/12 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-emerald-950 dark:text-emerald-100">
                  All 3 teach-back turns complete
                </p>
                <p className="text-xs sm:text-sm text-emerald-800/85 dark:text-emerald-200/80 mt-0.5">
                  ExaminerAgent grades your replies against NISM references and runs ADK Python math.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="emerald"
              size="lg"
              className="w-full sm:w-auto shrink-0"
              onClick={handleExamine}
              disabled={examining}
            >
              {examining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Scoring &amp; verifying math...
                </>
              ) : (
                <>
                  Reveal Score &amp; Weak Spot <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {error && (
          <ErrorBanner
            message={error}
            onRetry={turns.length === 0 ? retryInit : done ? handleExamine : undefined}
            retryLabel={turns.length === 0 ? "Retry" : "Retry Scoring"}
          />
        )}
      </CardContent>
    </Card>
  );
}
