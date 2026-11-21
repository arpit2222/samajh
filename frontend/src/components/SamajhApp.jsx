"use client";

import React, { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  AlertTriangle,
  Sun,
  Moon,
  TrendingDown,
  ShieldCheck,
  Shuffle,
  LogOut,
  UserRound,
  Award,
  Briefcase,
  FileSpreadsheet,
  ChevronRight,
  KeyRound,
  MessageSquareText,
  Trophy,
  Clock,
  Sparkles,
} from "lucide-react";
import { fetchHealth, setApiUser } from "../api.js";
import { subscribeToAuth, signOutUser } from "../lib/firebase.js";
import { Badge } from "./ui/badge.jsx";
import { Button } from "./ui/button.jsx";
import { Spinner } from "./ui/spinner.jsx";
import { ErrorBanner } from "./ui/error-banner.jsx";
import { ProgressStepper } from "./ui/progress-stepper.jsx";
import Login from "../screens/Login.jsx";
import Capture from "../screens/Capture.jsx";
import ConceptCard from "../screens/ConceptCard.jsx";
import TeachBackChat from "../screens/TeachBackChat.jsx";
import ScoreReveal from "../screens/ScoreReveal.jsx";
import StressTest from "../screens/StressTest.jsx";
import ResultScreen from "../screens/ResultScreen.jsx";
import MultiScenarioTest from "../screens/MultiScenarioTest.jsx";
import CredentialProfile from "../screens/CredentialProfile.jsx";
import EmployerDashboard from "../screens/EmployerDashboard.jsx";
import EmployerMatches from "../screens/EmployerMatches.jsx";
import TraderProfiler from "../screens/TraderProfiler.jsx";
import LeaderboardScreen from "../screens/LeaderboardScreen.jsx";
import DiscussionCircle from "../screens/DiscussionCircle.jsx";
import SessionHistory from "../screens/SessionHistory.jsx";

const VALID_TRADER_VIEWS = new Set([
  "flow",
  "profiler",
  "multi",
  "leaderboard",
  "discussion",
  "credential",
  "history",
]);
const SESSION_STORAGE_KEY = "samajh_active_session_v1";

class DemoErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Something went wrong." };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 p-8 text-center space-y-4">
          <AlertTriangle className="h-8 w-8 text-rose-500 mx-auto" />
          <div>
            <p className="font-bold text-rose-900 dark:text-rose-100">
              Something went wrong — recovered cleanly
            </p>
            <p className="text-sm text-rose-700 dark:text-rose-200/80 mt-1">{this.state.message}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, message: "" });
              this.props.onReset?.();
            }}
          >
            Try Again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SamajhApp() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null); // { uid, displayName, email, photoURL, role: 'trader'|'employer', isGuest }
  const [step, setStep] = useState(1);
  const [activeModule, setActiveModule] = useState("series-viii");
  const [traderView, setTraderView] = useState("flow"); // "flow" | "multi" | "leaderboard" | "credential" | "profiler" | "discussion" | "history"
  const [discussionSubtopic, setDiscussionSubtopic] = useState(null);
  const [prefillCaptureText, setPrefillCaptureText] = useState("");
  const [selectedRequisition, setSelectedRequisition] = useState(null);

  const [sessionData, setSessionData] = useState(null);
  const [examResult, setExamResult] = useState(null);
  const [stressResult, setStressResult] = useState(null);
  const [health, setHealth] = useState(null);
  const [darkMode, setDarkMode] = useState(false);

  // Restore theme, URL view query param, and active verification session on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("samajh_theme") : null;
    if (saved === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("request_token")) {
        setTraderView("profiler");
      } else {
        const viewParam = params.get("view");
        if (viewParam && VALID_TRADER_VIEWS.has(viewParam)) {
          setTraderView(viewParam);
        }
      }

      try {
        const rawSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
          if (parsed?.sessionData?.sessionId) {
            setSessionData(parsed.sessionData);
            if (parsed.examResult) setExamResult(parsed.examResult);
            if (parsed.stressResult) setStressResult(parsed.stressResult);
            if (parsed.activeModule) setActiveModule(parsed.activeModule);
            if (typeof parsed.step === "number" && parsed.step >= 1 && parsed.step <= 6) {
              setStep(parsed.step);
            }
          }
        }
      } catch {
        // ignore storage parse failure
      }
    }
  }, []);

  // Persist active verification progress across browser refresh
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionData?.sessionId) {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({ step, activeModule, sessionData, examResult, stressResult })
        );
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // ignore quota errors
    }
  }, [step, activeModule, sessionData, examResult, stressResult]);

  // Keep URL ?view= in sync with traderView (without interfering with Kite request_token)
  useEffect(() => {
    if (typeof window === "undefined" || !user || user.role === "employer") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("request_token")) return;
    if (traderView === "flow") {
      params.delete("view");
    } else {
      params.set("view", traderView);
    }
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [traderView, user]);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((fbUser) => {
      if (fbUser) {
        setUser((prev) => {
          const merged = { ...fbUser, role: prev?.role || "trader" };
          setApiUser(merged);
          return merged;
        });
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  function checkBackendHealth() {
    fetchHealth()
      .then((h) => setHealth(h))
      .catch(() => setHealth({ offline: true }));
  }

  useEffect(() => {
    checkBackendHealth();
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

  function handleAuthenticated(signedInUser) {
    setUser(signedInUser);
    setApiUser(signedInUser);
    setSelectedRequisition(null);
    setTraderView("flow");
    toast.success(
      `Signed in as ${signedInUser.displayName} (${
        signedInUser.role === "employer" ? "Employer" : "Trader"
      })`
    );
  }

  function handleGuestContinue() {
    const guestUser = {
      uid: null,
      displayName: "Guest",
      email: "",
      photoURL: "",
      role: "trader",
      isGuest: true,
    };
    setUser(guestUser);
    setApiUser(null);
    setTraderView("flow");
    toast.info("Continuing as Guest — anonymous demo session");
  }

  async function handleLogout() {
    try {
      if (user && !user.isGuest && user.uid !== "demo-employer-samajh") {
        await signOutUser();
      }
    } catch {
      // ignore sign-out errors
    }
    setUser(null);
    setApiUser(null);
    setTraderView("flow");
    setSelectedRequisition(null);
    setStep(1);
    setSessionData(null);
    setExamResult(null);
    setStressResult(null);
    toast.info("Signed out");
  }

  function handleResetJourney() {
    setTraderView("flow");
    setSelectedRequisition(null);
    setStep(1);
    setActiveModule("series-viii");
    setSessionData(null);
    setExamResult(null);
    setStressResult(null);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  const isEmployer = user?.role === "employer";
  const effectiveTotalSteps =
    sessionData?.hasStressTest === false || (!sessionData && activeModule !== "series-viii")
      ? 4
      : 6;

  return (
    <div className="min-h-dvh flex flex-col">
      <Toaster richColors position="top-center" theme={darkMode ? "dark" : "light"} />

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-8 flex-1 flex flex-col">
        {!authReady ? (
          <div className="flex-1 flex items-center justify-center py-24">
            <Spinner size="lg" label="Loading Samajh..." />
          </div>
        ) : !user ? (
          /* Entry Point: Login Screen (NO ProgressStepper rendered here) */
          <div className="flex-1 flex flex-col">
            <div className="flex justify-end">
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
            <div className="animate-screen-in flex-1 flex items-center justify-center">
              <Login
                onAuthenticated={handleAuthenticated}
                onGuestContinue={handleGuestContinue}
              />
            </div>
          </div>
        ) : (
          /* Post-Login Shell */
          <>
            <header className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border/80 flex-wrap">
              <button
                type="button"
                onClick={handleResetJourney}
                className="flex items-center gap-3 text-left group cursor-pointer"
              >
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-600 via-indigo-600 to-emerald-500 flex items-center justify-center font-extrabold text-lg text-white shadow-md shadow-brand-600/25 group-hover:scale-105 transition-transform">
                  S
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[19px] font-extrabold font-heading tracking-tight text-foreground">
                      Samajh
                    </span>
                    <Badge variant="default" className="text-[10px] py-0 px-2">
                      {isEmployer ? "Employer Portal" : "NISM Verifier"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-medium">Learn it. Prove it.</p>
                </div>
              </button>

              <div className="flex items-center gap-2">
                {!user.isGuest && (
                  <a href="/developer">
                    <Button type="button" variant="outline" size="sm" title="Developer API Keys & MCP">
                      <KeyRound className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Developer</span>
                    </Button>
                  </a>
                )}

                {/* User Pill */}
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName}
                      className="h-5 w-5 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="h-5 w-5 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                      {isEmployer ? (
                        <Briefcase className="h-3 w-3" />
                      ) : (
                        <UserRound className="h-3 w-3" />
                      )}
                    </span>
                  )}
                  <span className="max-w-[110px] truncate">
                    {user.isGuest ? "Guest" : user.displayName}
                  </span>
                </div>

                <Button type="button" variant="ghost" size="sm" onClick={handleLogout} title="Log out">
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>

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

            {/* Clean, single-row scrollable Trader Navigation Bar */}
            {!isEmployer && (
              <nav
                aria-label="Trader Navigation"
                className="mb-6 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
              >
                {[
                  { id: "flow", label: "Verify", icon: Sparkles },
                  { id: "profiler", label: "Trade Review", icon: FileSpreadsheet },
                  { id: "multi", label: "Gauntlet", icon: Shuffle },
                  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
                  { id: "discussion", label: "Circles", icon: MessageSquareText },
                  { id: "credential", label: "Credential", icon: Award },
                  { id: "history", label: "History", icon: Clock },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = traderView === tab.id;
                  return (
                    <Button
                      key={tab.id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "ghost"}
                      onClick={() => setTraderView(tab.id)}
                      className="shrink-0"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tab.label}</span>
                    </Button>
                  );
                })}
              </nav>
            )}

            {health?.offline && (
              <ErrorBanner
                className="mb-5"
                message="Could not reach the Samajh backend server. Verify your connection or start the backend, then retry."
                onRetry={checkBackendHealth}
                retryLabel="Reconnect"
              />
            )}

            {/* Employer Breadcrumb (NEVER renders Trader ProgressStepper) */}
            {isEmployer && (
              <nav
                aria-label="Employer Navigation"
                className="mb-6 rounded-xl border border-border bg-card/85 px-4 py-2.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`h-7 px-2.5 text-xs ${
                    !selectedRequisition ? "text-brand-700 dark:text-brand-300 font-bold" : ""
                  }`}
                  onClick={() => setSelectedRequisition(null)}
                >
                  Dashboard
                </Button>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span
                  className={
                    !selectedRequisition ? "text-foreground font-bold" : "text-muted-foreground"
                  }
                >
                  New Requisition
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span
                  className={
                    selectedRequisition
                      ? "text-brand-700 dark:text-brand-300 font-bold"
                      : "text-muted-foreground/60"
                  }
                >
                  Matches{selectedRequisition ? ` (${selectedRequisition.title})` : ""}
                </span>
              </nav>
            )}

            {/* Trader Thesis Strip + Persistent ProgressStepper */}
            {!isEmployer && traderView === "flow" && (
              <>
                {step === 1 && (
                  <div className="mb-5 rounded-2xl border border-border bg-card/85 px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
                    <div className="flex items-center gap-2.5 text-xs sm:text-[13px] text-muted-foreground">
                      <span className="h-7 w-7 rounded-lg bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                        <TrendingDown className="h-3.5 w-3.5" />
                      </span>
                      <span>
                        <strong className="text-foreground">87.7% of retail F&amp;O traders</strong>{" "}
                        lost <span className="font-mono font-semibold text-foreground">₹91,685 Cr</span>{" "}
                        in FY26.
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      <span>Scores causal reasoning — never P&amp;L luck</span>
                    </div>
                  </div>
                )}
                <ProgressStepper currentStep={step} totalSteps={effectiveTotalSteps} />
              </>
            )}

            <main className="flex-1">
              <DemoErrorBoundary onReset={handleResetJourney}>
                <div
                  key={
                    isEmployer
                      ? selectedRequisition
                        ? `emp-match-${selectedRequisition.id}`
                        : "emp-dash"
                      : `${traderView}-${step}`
                  }
                  className="animate-screen-in"
                >
                  {isEmployer ? (
                    selectedRequisition ? (
                      <EmployerMatches
                        requisition={selectedRequisition}
                        onBack={() => setSelectedRequisition(null)}
                      />
                    ) : (
                      <EmployerDashboard
                        onSelectRequisition={(req) => setSelectedRequisition(req)}
                      />
                    )
                  ) : traderView === "profiler" ? (
                    <TraderProfiler
                      onBack={() => setTraderView("flow")}
                      onJumpToTeachBack={(seededSession) => {
                        setSessionData(seededSession);
                        setExamResult(null);
                        setStressResult(null);
                        setStep(3); // Skip ingestAgent & conceptAgent — jump straight into socraticAgent
                        setTraderView("flow");
                        toast.success(
                          `Live Teach-Back started on "${seededSession.concept_name}"`
                        );
                      }}
                    />
                  ) : traderView === "credential" ? (
                    <CredentialProfile
                      user={user}
                      onRequestSignIn={handleLogout}
                      onBack={() => setTraderView("flow")}
                    />
                  ) : traderView === "multi" ? (
                    <MultiScenarioTest
                      onOpenLeaderboard={() => setTraderView("leaderboard")}
                      onExit={() => setTraderView("flow")}
                    />
                  ) : traderView === "leaderboard" ? (
                    <LeaderboardScreen
                      onStartGauntlet={() => setTraderView("multi")}
                      onBack={() => setTraderView("flow")}
                    />
                  ) : traderView === "discussion" ? (
                    <DiscussionCircle
                      initialSubtopic={discussionSubtopic || stressResult?.concept_tag}
                      sessionId={sessionData?.sessionId}
                      onStartPractice={(starterText) => {
                        if (typeof starterText === "string" && starterText.trim()) {
                          setPrefillCaptureText(starterText);
                        }
                        setStep(1);
                        setSessionData(null);
                        setExamResult(null);
                        setStressResult(null);
                        setTraderView("flow");
                      }}
                      onBack={() => setTraderView("flow")}
                    />
                  ) : traderView === "history" ? (
                    <SessionHistory
                      user={user}
                      onRequestSignIn={handleLogout}
                      onStartNew={handleResetJourney}
                      onBack={() => setTraderView("flow")}
                    />
                  ) : (
                    <>
                      {step === 1 && (
                        <Capture
                          initialText={prefillCaptureText}
                          onModuleChange={(modId) => setActiveModule(modId)}
                          onIngested={(data) => {
                            setPrefillCaptureText("");
                            setActiveModule(data.module || "series-viii");
                            setSessionData(data);
                            setExamResult(null);
                            setStressResult(null);
                            toast.success("Core concept extracted — ready for teach-back");
                            setStep(2);
                          }}
                        />
                      )}

                      {step === 2 && sessionData && (
                        <ConceptCard
                          sessionData={sessionData}
                          onProceed={() => setStep(3)}
                          onReset={handleResetJourney}
                        />
                      )}

                      {step === 3 && sessionData && (
                        <TeachBackChat
                          sessionData={sessionData}
                          onExamined={(result) => {
                            setExamResult(result);
                            toast.info(`Weak spot pinpointed: ${result.weak_subtopic}`);
                            setStep(4);
                          }}
                        />
                      )}

                      {step === 4 && sessionData && examResult && (
                        <ScoreReveal
                          sessionData={sessionData}
                          examResult={examResult}
                          onStartStressTest={() => setStep(5)}
                          onReset={handleResetJourney}
                        />
                      )}

                      {step === 5 && sessionData && examResult && (
                        <StressTest
                          sessionData={sessionData}
                          examResult={examResult}
                          onCompleted={(result) => {
                            setStressResult(result);
                            toast.success("Historical stress-test graded — mastery report ready");
                            setStep(6);
                          }}
                        />
                      )}

                      {step === 6 && sessionData && examResult && stressResult && (
                        <ResultScreen
                          user={user}
                          sessionData={sessionData}
                          examResult={examResult}
                          stressResult={stressResult}
                          onRequestSignIn={handleLogout}
                          onOpenCredential={() => setTraderView("credential")}
                          onStartMultiScenario={() => setTraderView("multi")}
                          onOpenLeaderboard={() => setTraderView("leaderboard")}
                          onOpenDiscussion={(subtopic) => {
                            setDiscussionSubtopic(subtopic || null);
                            setTraderView("discussion");
                          }}
                          onReset={handleResetJourney}
                        />
                      )}
                    </>
                  )}
                </div>
              </DemoErrorBoundary>
            </main>

            <footer className="mt-10 pt-5 border-t border-border/70 flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
              <span className="font-medium">
                Samajh · Verifiable Financial Understanding for NISM &amp; Hiring
              </span>
              <span className="font-mono text-[11px]">
                Firebase Auth · ADK 5-Agent · HMAC-SHA256 Credentials · Firestore
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
