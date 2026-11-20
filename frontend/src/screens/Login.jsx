"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Mail,
  Lock,
  ArrowRight,
  UserRound,
  TrendingDown,
  Briefcase,
  GraduationCap,
} from "lucide-react";
import {
  isFirebaseAuthConfigured,
  signInWithGoogle,
  signInWithEmail,
} from "../lib/firebase.js";
import { syncUserProfile } from "../api.js";
import { Button } from "../components/ui/button.jsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.jsx";
import { Input } from "../components/ui/input.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Spinner } from "../components/ui/spinner.jsx";
import { ErrorBanner } from "../components/ui/error-banner.jsx";

function GoogleLogo() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.29V6.62H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.99 3.09c.95-2.84 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export default function Login({ onAuthenticated, onGuestContinue }) {
  const [role, setRole] = useState("trader"); // "trader" | "employer"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState("");

  const firebaseReady = isFirebaseAuthConfigured();
  const busy = loadingGoogle || loadingEmail || loadingDemo;

  async function finalizeUser(userObj) {
    const withRole = { ...userObj, role };
    if (withRole.uid) {
      try {
        await syncUserProfile(withRole);
      } catch {
        // Non-fatal if backend sync hiccups — headers will auto-sync on next call
      }
    }
    onAuthenticated(withRole);
  }

  async function handleGoogleLogin() {
    setError("");
    setLoadingGoogle(true);
    try {
      const user = await signInWithGoogle();
      await finalizeUser(user);
    } catch (err) {
      const msg =
        err?.code === "auth/popup-closed-by-user"
          ? "Sign-in popup was closed. Try again or use the instant demo option below."
          : err?.message || "Google Sign-In failed. You can retry or continue below.";
      setError(msg);
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError("");
    if (!email.trim() || password.length < 6) {
      setError("Enter a valid email and a password of at least 6 characters.");
      return;
    }

    setLoadingEmail(true);
    try {
      const user = await signInWithEmail(email, password, { createAccount: isSignUp });
      await finalizeUser(user);
    } catch (err) {
      setError(err?.message || "Email authentication failed. Check credentials or continue below.");
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleGuestOrDemo() {
    setError("");
    if (role === "trader") {
      onGuestContinue();
      return;
    }

    // Demo Employer safety net when venue Wi-Fi / Firebase OAuth isn't configured
    setLoadingDemo(true);
    try {
      const demoEmployer = {
        uid: "demo-employer-samajh",
        displayName: "Demo Hiring Manager",
        email: "hiring@samajh.demo",
        photoURL: "",
        role: "employer",
        isGuest: false,
      };
      await syncUserProfile(demoEmployer);
      onAuthenticated(demoEmployer);
    } catch (err) {
      setError(err?.message || "Could not start Employer demo session. Check backend status.");
    } finally {
      setLoadingDemo(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-4 sm:py-8 space-y-5">
      {/* Brand hero */}
      <div className="text-center space-y-2">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-600 via-indigo-600 to-emerald-500 flex items-center justify-center font-extrabold text-xl text-white shadow-lg shadow-brand-600/25 mx-auto">
          S
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold font-heading tracking-tight text-foreground">
          Samajh
        </h1>
        <p className="text-sm text-muted-foreground">
          Learn it. Prove it. — Verifiable financial understanding.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="default">
              <ShieldCheck className="h-3.5 w-3.5" /> Firebase Authentication
            </Badge>
            <Badge variant="secondary" className="text-[10.5px]">
              {role === "employer" ? "Employer Portal" : "Trader / NISM"}
            </Badge>
          </div>
          <CardTitle className="pt-1 text-xl sm:text-2xl">
            {role === "employer"
              ? "Hire verified financial talent"
              : isSignUp
                ? "Create your learner account"
                : "Sign in to verify & save"}
          </CardTitle>
          <CardDescription>
            {role === "employer"
              ? "Set required NISM concepts and minimum reasoning scores to match opt-in verified candidates."
              : "Tie your teach-back scores, stress-tests, and tamper-evident credential to your account."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Role Toggle: "I'm a trader" vs "I'm hiring" */}
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1 border border-border">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRole("trader");
                setError("");
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                role === "trader"
                  ? "bg-card text-foreground shadow-sm border border-border/70"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <GraduationCap className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              I&apos;m a trader
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRole("employer");
                setError("");
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                role === "employer"
                  ? "bg-card text-foreground shadow-sm border border-border/70"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Briefcase className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              I&apos;m hiring
            </button>
          </div>

          {/* Primary: One-tap Google Sign-In */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full font-semibold"
            disabled={busy}
            onClick={handleGoogleLogin}
          >
            {loadingGoogle ? (
              <Spinner size="sm" label="Connecting to Google..." />
            ) : (
              <>
                <GoogleLogo /> Continue with Google
              </>
            )}
          </Button>

          {/* Divider */}
          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-border" />
            <span className="mx-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              or email fallback
            </span>
            <div className="flex-grow border-t border-border" />
          </div>

          {/* Fallback: Email & Password */}
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder={role === "employer" ? "recruiter@firm.com" : "candidate@example.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Password
              </label>
              <Input
                id="login-password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {loadingEmail ? (
                <Spinner
                  size="sm"
                  label={isSignUp ? "Creating account..." : "Signing in..."}
                  className="text-white"
                />
              ) : (
                <>
                  {isSignUp ? "Create Account" : "Sign in with Email"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            <div className="text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setIsSignUp((v) => !v);
                  setError("");
                }}
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer"
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "New to Samajh? Create an email account"}
              </button>
            </div>
          </form>

          {error && (
            <ErrorBanner
              message={error}
              onRetry={loadingEmail ? undefined : handleGoogleLogin}
              retryLabel="Retry Google"
            />
          )}

          {!firebaseReady && !error && (
            <p className="text-[11.5px] text-center text-muted-foreground">
              Firebase web keys not set in <code className="font-mono">frontend/.env</code> yet — use
              the instant demo button below.
            </p>
          )}
        </CardContent>

        {/* Demo Safety Net */}
        <CardFooter className="flex-col items-stretch gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full font-bold"
            disabled={busy}
            onClick={handleGuestOrDemo}
          >
            {loadingDemo ? (
              <Spinner size="sm" label="Opening Employer Dashboard..." />
            ) : role === "employer" ? (
              <>
                <Briefcase className="h-4 w-4" /> Continue as Demo Employer
              </>
            ) : (
              <>
                <UserRound className="h-4 w-4" /> Continue as Guest (Instant Demo)
              </>
            )}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground">
            {role === "employer"
              ? "Opens the Employer Dashboard immediately with seeded verified candidates."
              : "Skips sign-in and runs a throwaway anonymous session — works even without OAuth."}
          </p>
        </CardFooter>
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <TrendingDown className="h-3.5 w-3.5 text-rose-500 shrink-0" />
        <span>87.7% of retail F&amp;O traders lost ₹91,685 Cr in FY26 · Verify reasoning first.</span>
      </div>
    </div>
  );
}
