"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Send,
  CheckCircle2,
  ArrowRight,
  Loader2,
  User,
  Bot,
  Mic,
  MicOff,
  Keyboard,
  Languages,
  Radio,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { sendTeachBack, examineSession } from "../api.js";
import { getLanguageConfig } from "../lib/languages.js";
import {
  createPcmPlayer,
  getLiveTeachbackWsUrl,
  startPcmMicCapture,
} from "../lib/liveAudioClient.js";
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
  const langConfig = getLanguageConfig(sessionData?.language);
  const isHindi = langConfig.code === "hi-IN";
  const uiCopy = isHindi
    ? {
        title: "नौसिखिए की गलती सुधारें",
        subtitle:
          "समझाएं कि उसने क्या गलत समझा और असली तंत्र कैसे काम करता है। परीक्षक केवल आपके उत्तरों का मूल्यांकन करता है।",
        userLabel: "आपका उत्तर",
        agentLabel: "नौसिखिया",
        sendLabel: "भेजें",
        switchToTyping: "टाइपिंग पर जाएं",
      }
    : {
        title: "Correct the confused novice",
        subtitle:
          "Spot the flaw in their restatement and explain why in plain language. Switch between Live voice and typing anytime without losing progress.",
        userLabel: "Your Explanation",
        agentLabel: "Confused Novice",
        sendLabel: "Send",
        switchToTyping: "Switch to Typing",
      };

  const [showConceptRef, setShowConceptRef] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [turns, setTurns] = useState([]);
  const [agentTurns, setAgentTurns] = useState(0);
  const [done, setDone] = useState(false);
  const [userText, setUserText] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [sending, setSending] = useState(false);
  const [examining, setExamining] = useState(false);
  const [error, setError] = useState("");

  // Bidirectional Gemini Live WebSocket Voice Mode with mandatory always-visible typing fallback
  const [inputMode, setInputMode] = useState("typing"); // "typing" | "voice"
  const [liveStatus, setLiveStatus] = useState("idle"); // "idle" | "connecting" | "connected" | "disconnected"
  const [micActive, setMicActive] = useState(false);
  const [liveUserTranscript, setLiveUserTranscript] = useState("");
  const [liveAgentTranscript, setLiveAgentTranscript] = useState("");

  const wsRef = useRef(null);
  const micHandleRef = useRef(null);
  const playerRef = useRef(null);
  const doneRef = useRef(false);
  const intentionalCloseRef = useRef(false);

  const initializedSessionRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    doneRef.current = done;
  }, [done]);

  const stopMic = useCallback(() => {
    try {
      micHandleRef.current?.stop();
    } catch {
      // ignore
    }
    micHandleRef.current = null;
    setMicActive(false);
    setMicLevel(0);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "audio_end" }));
    }
  }, []);

  const closeLiveSession = useCallback(
    ({ intentional = true } = {}) => {
      intentionalCloseRef.current = intentional;
      stopMic();
      try {
        playerRef.current?.close();
      } catch {
        // ignore
      }
      playerRef.current = null;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      setLiveStatus("idle");
      setLiveUserTranscript("");
      setLiveAgentTranscript("");
    },
    [stopMic]
  );

  useEffect(() => {
    return () => {
      closeLiveSession({ intentional: true });
    };
  }, [closeLiveSession]);

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
  }, [turns, sending, initializing, liveUserTranscript, liveAgentTranscript]);

  function openLiveVoiceSession() {
    if (!sessionData?.sessionId || done) return;
    closeLiveSession({ intentional: true });
    setInputMode("voice");
    setLiveStatus("connecting");
    setError("");
    intentionalCloseRef.current = false;

    const wsUrl = getLiveTeachbackWsUrl(sessionData.sessionId);
    const player = createPcmPlayer(24000);
    playerRef.current = player;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setLiveStatus("connected");
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "ready") {
        setLiveStatus("connected");
        if (Array.isArray(msg.turns) && msg.turns.length > 0) {
          setTurns(msg.turns);
        }
        if (typeof msg.agentTurns === "number") {
          setAgentTurns(msg.agentTurns);
        }
        if (msg.done) {
          setDone(true);
          closeLiveSession({ intentional: true });
        }
      } else if (msg.type === "audio" && msg.data) {
        player.enqueueBase64(msg.data);
      } else if (msg.type === "input_transcript" && msg.text) {
        setLiveUserTranscript((prev) => `${prev}${msg.text}`);
      } else if (msg.type === "output_transcript" && msg.text) {
        setLiveAgentTranscript((prev) => `${prev}${msg.text}`);
      } else if (msg.type === "interrupted") {
        player.clear();
      } else if (msg.type === "turn_complete") {
        setLiveUserTranscript("");
        setLiveAgentTranscript("");
        if (Array.isArray(msg.turns)) {
          setTurns(msg.turns);
        }
        if (typeof msg.agentTurns === "number") {
          setAgentTurns(msg.agentTurns);
        }
        if (msg.done) {
          setDone(true);
          stopMic();
          toast.success("All 3 Live voice turns complete — ready for Examiner scoring");
        }
      } else if (msg.type === "error") {
        toast.error(
          msg.message ||
            "Gemini Live voice connection interrupted — switched to typing with your turns preserved."
        );
        closeLiveSession({ intentional: true });
        setInputMode("typing");
      }
    };

    ws.onerror = () => {
      if (!intentionalCloseRef.current && !doneRef.current) {
        toast.error(
          "Live voice WebSocket dropped — switched to typing without losing your progress."
        );
        closeLiveSession({ intentional: true });
        setInputMode("typing");
      }
    };

    ws.onclose = () => {
      if (!intentionalCloseRef.current && !doneRef.current) {
        stopMic();
        setLiveStatus("disconnected");
        setInputMode("typing");
        toast.info("Live voice disconnected — continue seamlessly in Typing Mode.");
      }
    };
  }

  async function toggleMicStream() {
    if (micActive) {
      stopMic();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Live voice WebSocket is not connected yet.");
      return;
    }
    try {
      const handle = await startPcmMicCapture({
        onLevel: (lvl) => setMicLevel(lvl),
        onPcmChunk: (base64Pcm) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "audio",
                data: base64Pcm,
                mimeType: "audio/pcm;rate=16000",
              })
            );
          }
        },
      });
      micHandleRef.current = handle;
      setMicActive(true);
    } catch (err) {
      toast.error(
        `${err.message || "Microphone permission blocked"} — switched to typing.`
      );
      closeLiveSession({ intentional: true });
      setInputMode("typing");
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
    stopMic();
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
    closeLiveSession({ intentional: true });
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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-[11px]">
              <Languages className="h-3 w-3" /> {langConfig.nativeLabel} ({langConfig.code})
            </Badge>
            {!done && (
              <Button
                type="button"
                size="sm"
                variant={inputMode === "voice" ? "default" : "outline"}
                onClick={() => {
                  if (inputMode === "voice") {
                    closeLiveSession({ intentional: true });
                    setInputMode("typing");
                  } else {
                    openLiveVoiceSession();
                  }
                }}
              >
                {inputMode === "voice" ? (
                  <>
                    <Keyboard className="h-3.5 w-3.5" /> {uiCopy.switchToTyping}
                  </>
                ) : (
                  <>
                    <Radio className="h-3.5 w-3.5" /> Gemini Live Voice
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
        <CardTitle className="pt-1">{uiCopy.title}</CardTitle>
        <CardDescription>{uiCopy.subtitle}</CardDescription>

        {/* Collapsible Concept Reminder so learner can glance back without resetting */}
        {sessionData?.concept && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowConceptRef((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:underline cursor-pointer"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showConceptRef ? "Hide Concept Reference" : "Review Concept Card"}
              {showConceptRef ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            {showConceptRef && (
              <div className="mt-2 rounded-xl border border-border bg-muted/45 p-3.5 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">{sessionData.concept}</p>
                {sessionData.analogy && (
                  <p className="text-muted-foreground leading-relaxed">{sessionData.analogy}</p>
                )}
              </div>
            )}
          </div>
        )}

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
                    {isUser ? uiCopy.userLabel : uiCopy.agentLabel}
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

          {liveUserTranscript && (
            <div className="flex justify-end">
              <div className="max-w-[84%] rounded-2xl rounded-br-sm bg-blue-600/80 text-white px-4 py-2.5 text-sm italic">
                {liveUserTranscript}
              </div>
            </div>
          )}

          {liveAgentTranscript && (
            <div className="flex justify-start">
              <div className="max-w-[84%] rounded-2xl rounded-bl-sm bg-card border border-blue-300 dark:border-blue-500/40 px-4 py-2.5 text-sm text-foreground">
                {liveAgentTranscript}
              </div>
            </div>
          )}

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

        {/* Composer: Bidirectional Gemini Live Voice bar + always-visible Typing fallback */}
        {!done ? (
          <form onSubmit={handleSend} className="space-y-3">
            {inputMode === "voice" && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-500/35 bg-blue-50/70 dark:bg-blue-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant={micActive ? "destructive" : "default"}
                    onClick={toggleMicStream}
                    disabled={liveStatus !== "connected" || sending || initializing}
                  >
                    {micActive ? (
                      <>
                        <MicOff className="h-4 w-4" /> Finish Speaking
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4" />{" "}
                        {liveStatus === "connecting"
                          ? "Connecting Live WS..."
                          : `Speak Live (${langConfig.speechLang})`}
                      </>
                    )}
                  </Button>
                  {micActive && (
                    <div className="flex items-center gap-1.5" aria-label="Live microphone level">
                      <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                      <div className="w-20 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-75"
                          style={{ width: `${Math.max(8, micLevel)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {liveStatus === "connecting"
                      ? "Opening persistent Gemini Live WebSocket..."
                      : micActive
                        ? "Live mic active — click Finish Speaking when done."
                        : "Connected to Gemini Live (24kHz audio playback ready)."}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    closeLiveSession({ intentional: true });
                    setInputMode("typing");
                  }}
                >
                  <Keyboard className="h-3.5 w-3.5" /> {uiCopy.switchToTyping}
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
                placeholder={langConfig.placeholder}
              />
              <Button
                type="submit"
                size="lg"
                className="sm:h-12 shrink-0"
                disabled={sending || initializing || !userText.trim() || turns.length === 0}
              >
                <Send className="h-4 w-4" /> {uiCopy.sendLabel}
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
