"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Flame,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  TrendingDown,
} from "lucide-react";
import { fetchHistoricalScenarios } from "../api.js";
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

function formatINR(num) {
  const abs = Math.abs(Math.round(num));
  const formatted = abs.toLocaleString("en-IN");
  return num < 0 ? `-₹${formatted}` : `₹${formatted}`;
}

const LAB_TABS = [
  { id: "options", label: "Option Payoff Curve", icon: Activity },
  { id: "margin", label: "MTM Margin Call", icon: ShieldAlert },
  { id: "gap", label: "Gap vs Stop-Loss", icon: TrendingDown },
  { id: "shocks", label: "26 Market Shocks", icon: Flame },
];

const SHOCK_FILTERS = [
  { id: "all", label: "All Events" },
  { id: "circuit_breaker_margin_risk", label: "Circuit Halts" },
  { id: "overnight_gap_stoploss_risk", label: "Overnight Gaps" },
  { id: "event_volatility_option_writing_risk", label: "Event Volatility" },
  { id: "regulatory_moratorium_liquidity_risk", label: "Moratoriums" },
];

/* --------------------------------------------------------------------------
 * LAB 1: Option Payoff & Buyer vs Writer Asymmetry Explorer
 * -------------------------------------------------------------------------- */
function OptionPayoffLab({ onPracticeConcept }) {
  const [strategy, setStrategy] = useState("short_call"); // long_call | long_put | short_call | short_put
  const [strike, setStrike] = useState(24000);
  const [premium, setPremium] = useState(200);
  const [lotSize, setLotSize] = useState(75);
  const [spot, setSpot] = useState(24400);

  const calcPnl = (s) => {
    const intrinsicCall = Math.max(0, s - strike);
    const intrinsicPut = Math.max(0, strike - s);
    if (strategy === "long_call") return (intrinsicCall - premium) * lotSize;
    if (strategy === "long_put") return (intrinsicPut - premium) * lotSize;
    if (strategy === "short_call") return (premium - intrinsicCall) * lotSize;
    return (premium - intrinsicPut) * lotSize;
  };

  const minSpot = strike - 1200;
  const maxSpot = strike + 1200;
  const breakeven =
    strategy === "long_call" || strategy === "short_call"
      ? strike + premium
      : strike - premium;
  const currentPnl = calcPnl(spot);
  const isWriter = strategy === "short_call" || strategy === "short_put";

  const chart = useMemo(() => {
    const samples = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const s = minSpot + ((maxSpot - minSpot) * i) / steps;
      samples.push({ s, pnl: calcPnl(s) });
    }
    const maxAbsPnl = Math.max(
      premium * lotSize * 2,
      ...samples.map((p) => Math.abs(p.pnl))
    );
    const W = 440;
    const H = 170;
    const padX = 24;
    const midY = H / 2;
    const scaleX = (s) => padX + ((s - minSpot) / (maxSpot - minSpot)) * (W - padX * 2);
    const scaleY = (pnl) => midY - (pnl / maxAbsPnl) * (H / 2 - 20);

    const pathD = samples
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${scaleX(pt.s).toFixed(1)} ${scaleY(pt.pnl).toFixed(1)}`)
      .join(" ");

    return {
      W,
      H,
      midY,
      pathD,
      spotX: scaleX(Math.max(minSpot, Math.min(maxSpot, spot))),
      spotY: scaleY(currentPnl),
      beX: scaleX(Math.max(minSpot, Math.min(maxSpot, breakeven))),
      strikeX: scaleX(strike),
    };
  }, [strategy, strike, premium, lotSize, spot, minSpot, maxSpot, breakeven, currentPnl]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {[
          { id: "long_call", label: "Long Call (Buyer)" },
          { id: "long_put", label: "Long Put (Buyer)" },
          { id: "short_call", label: "Short Call (Writer)" },
          { id: "short_put", label: "Short Put (Writer)" },
        ].map((opt) => (
          <Button
            key={opt.id}
            type="button"
            size="sm"
            variant={strategy === opt.id ? "default" : "outline"}
            onClick={() => setStrategy(opt.id)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Live Payoff SVG */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
          <span className="font-mono font-semibold text-foreground">
            Strike ₹{strike.toLocaleString("en-IN")} · Breakeven ₹{breakeven.toLocaleString("en-IN")}
          </span>
          <Badge variant={currentPnl >= 0 ? "success" : "destructive"} className="font-mono">
            At Spot ₹{spot.toLocaleString("en-IN")}: {formatINR(currentPnl)}
          </Badge>
        </div>

        <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-44 overflow-visible">
          {/* Zero P&L axis */}
          <line
            x1="20"
            y1={chart.midY}
            x2={chart.W - 20}
            y2={chart.midY}
            stroke="currentColor"
            className="stroke-border"
            strokeWidth="1.5"
          />
          {/* Breakeven vertical marker */}
          <line
            x1={chart.beX}
            y1="14"
            x2={chart.beX}
            y2={chart.H - 14}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* Payoff curve */}
          <path
            d={chart.pathD}
            fill="none"
            stroke={currentPnl >= 0 ? "#059669" : "#e11d48"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Live draggable Spot marker */}
          <circle
            cx={chart.spotX}
            cy={chart.spotY}
            r="6"
            fill={currentPnl >= 0 ? "#059669" : "#e11d48"}
            stroke="#ffffff"
            strokeWidth="2"
          />
        </svg>

        <div className="grid grid-cols-3 gap-2.5 text-center pt-1">
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Max Profit</div>
            <div className="text-sm font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
              {isWriter ? formatINR(premium * lotSize) : "Uncapped"}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Max Loss</div>
            <div className="text-sm font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
              {strategy === "short_call"
                ? "Unlimited"
                : strategy === "short_put"
                  ? "Down to ₹0"
                  : formatINR(-premium * lotSize)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Role Risk</div>
            <div className="text-sm font-extrabold text-foreground mt-0.5">
              {isWriter ? "Obligation + SPAN" : "Capped Premium"}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-border bg-muted/35 p-4">
        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Spot Price at Expiry</span>
            <span className="font-mono text-brand-600 dark:text-brand-400">
              ₹{spot.toLocaleString("en-IN")}
            </span>
          </div>
          <input
            type="range"
            min={minSpot}
            max={maxSpot}
            step={50}
            value={spot}
            onChange={(e) => setSpot(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Option Premium</span>
            <span className="font-mono">₹{premium}</span>
          </div>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={premium}
            onChange={(e) => setPremium(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Strike Price</span>
            <span className="font-mono">₹{strike.toLocaleString("en-IN")}</span>
          </div>
          <input
            type="range"
            min={20000}
            max={26000}
            step={200}
            value={strike}
            onChange={(e) => {
              const nextStrike = Number(e.target.value);
              setStrike(nextStrike);
              setSpot(nextStrike + 400);
            }}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Lot Size (Units)</span>
            <span className="font-mono">{lotSize}</span>
          </div>
          <input
            type="range"
            min={25}
            max={150}
            step={25}
            value={lotSize}
            onChange={(e) => setLotSize(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border bg-card p-3.5">
        <p className="text-xs text-muted-foreground">
          <strong>Key takeaway:</strong> An option writer collects capped premium upfront but faces
          asymmetric loss + daily MTM margin calls when spot crosses breakeven.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onPracticeConcept(
              "An option buyer pays an upfront premium and holds a right without obligation; maximum loss is strictly capped at the premium paid. An option writer (seller) collects the premium upfront but carries an obligation upon assignment: a naked call writer faces theoretically unlimited loss if the underlying rallies sharply, and must post full SPAN + Exposure margins with daily MTM."
            )
          }
        >
          Verify This Concept <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * LAB 2: Futures MTM & Margin Call Simulator
 * -------------------------------------------------------------------------- */
function MarginCallLab({ onPracticeConcept }) {
  const [notionalLakhs, setNotionalLakhs] = useState(12); // ₹12,00,000
  const [initialMarginPct, setInitialMarginPct] = useState(20);
  const [maintMarginPct, setMaintMarginPct] = useState(14);
  const [adverseMovePct, setAdverseMovePct] = useState(7);

  const notional = notionalLakhs * 100000;
  const initialMargin = Math.round((notional * initialMarginPct) / 100);
  const maintenanceMargin = Math.round((notional * Math.min(maintMarginPct, initialMarginPct - 2)) / 100);
  const mtmLoss = Math.round((notional * adverseMovePct) / 100);
  const remainingEquity = initialMargin - mtmLoss;
  const cashShortfall = Math.max(0, initialMargin - remainingEquity);

  const status =
    remainingEquity <= 0
      ? { label: "Forced Broker Square-Off (Margin Wiped)", variant: "destructive" }
      : remainingEquity < maintenanceMargin
        ? { label: "Margin Call Triggered (T+1 Cash Shortfall)", variant: "warning" }
        : { label: "Margin Buffer Healthy", variant: "success" };

  const equityPctOfInitial = Math.max(0, Math.min(100, Math.round((remainingEquity / initialMargin) * 100)));
  const maintPctOfInitial = Math.max(0, Math.min(100, Math.round((maintenanceMargin / initialMargin) * 100)));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-mono font-semibold text-foreground">
            Notional {formatINR(notional)} · Leverage {(100 / initialMarginPct).toFixed(1)}x
          </span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        {/* Visual Margin Equity Bar with Maintenance Threshold Line */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-mono text-muted-foreground">
            <span>Remaining Equity: {formatINR(remainingEquity)}</span>
            <span>Initial Margin: {formatINR(initialMargin)}</span>
          </div>
          <div className="relative h-8 rounded-xl bg-muted border border-border overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                remainingEquity <= 0
                  ? "bg-rose-600"
                  : remainingEquity < maintenanceMargin
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${equityPctOfInitial}%` }}
            />
            {/* Maintenance Margin Threshold Marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-600 dark:bg-rose-400"
              style={{ left: `${maintPctOfInitial}%` }}
              title={`Maintenance Margin: ${formatINR(maintenanceMargin)}`}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
            <span>₹0 (Square-off)</span>
            <span className="text-rose-600 dark:text-rose-400 font-semibold">
              Maintenance Floor: {formatINR(maintenanceMargin)}
            </span>
            <span>100% Posted</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Daily MTM Debit</div>
            <div className="text-sm font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
              {formatINR(-mtmLoss)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Equity Left</div>
            <div className="text-sm font-extrabold font-mono text-foreground mt-0.5">
              {formatINR(remainingEquity)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Top-Up Needed</div>
            <div className="text-sm font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
              {remainingEquity < maintenanceMargin ? formatINR(cashShortfall) : "₹0"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-border bg-muted/35 p-4">
        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Adverse Price Move (%)</span>
            <span className="font-mono text-rose-600 dark:text-rose-400">-{adverseMovePct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={25}
            step={0.5}
            value={adverseMovePct}
            onChange={(e) => setAdverseMovePct(Number(e.target.value))}
            className="w-full accent-rose-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Contract Notional Value</span>
            <span className="font-mono">₹{notionalLakhs} Lakh</span>
          </div>
          <input
            type="range"
            min={5}
            max={25}
            step={1}
            value={notionalLakhs}
            onChange={(e) => setNotionalLakhs(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Initial Margin (SPAN + Exposure)</span>
            <span className="font-mono">{initialMarginPct}%</span>
          </div>
          <input
            type="range"
            min={15}
            max={30}
            step={1}
            value={initialMarginPct}
            onChange={(e) => setInitialMarginPct(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Maintenance Margin Threshold</span>
            <span className="font-mono">{Math.min(maintMarginPct, initialMarginPct - 2)}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={22}
            step={1}
            value={maintMarginPct}
            onChange={(e) => setMaintMarginPct(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border bg-card p-3.5">
        <p className="text-xs text-muted-foreground">
          <strong>Key takeaway:</strong> Even a {initialMarginPct - Math.min(maintMarginPct, initialMarginPct - 2) + 1}% adverse move triggers a T+1 MTM cash margin call — brokers square off regardless of your expiry view.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onPracticeConcept(
              "At the end of every trading day, open futures positions are Marked-to-Market (MTM) against the daily settlement price. Any MTM loss is debited in cash on a T+0/T+1 basis. If margin balance drops below maintenance requirements, the broker issues a margin call or automatically squares off the position."
            )
          }
        >
          Verify This Concept <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * LAB 3: Overnight Gap vs Stop-Loss Slippage Visualizer
 * -------------------------------------------------------------------------- */
function GapSlippageLab({ onPracticeConcept }) {
  const [priorClose] = useState(1000);
  const [plannedSlPct, setPlannedSlPct] = useState(3);
  const [gapDownPct, setGapDownPct] = useState(18);
  const [qty, setQty] = useState(500);

  const slPrice = Math.round(priorClose * (1 - plannedSlPct / 100));
  const openFillPrice = Math.round(priorClose * (1 - gapDownPct / 100));
  const plannedLoss = (priorClose - slPrice) * qty;
  const actualLoss = Math.max(plannedLoss, (priorClose - openFillPrice) * qty);
  const slippageExtra = Math.max(0, actualLoss - plannedLoss);

  const slY = 24 + (plannedSlPct / 30) * 84;
  const gapY = 24 + (gapDownPct / 30) * 84;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
          <span className="font-semibold text-foreground">
            Prior Close ₹{priorClose} · Planned SL ₹{slPrice} (-{plannedSlPct}%)
          </span>
          <Badge variant={slippageExtra > 0 ? "destructive" : "success"}>
            {slippageExtra > 0
              ? `SL Skipped · Filled at ₹${openFillPrice} (-${gapDownPct}%)`
              : `Filled cleanly at Stop-Loss ₹${slPrice}`}
          </Badge>
        </div>

        <svg viewBox="0 0 420 120" className="w-full h-32 overflow-visible">
          {/* Prior Close path */}
          <path d="M 15 24 L 150 24" stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
          <circle cx="150" cy="24" r="4" fill="#64748b" />
          {/* Planned Stop-Loss dashed line */}
          <line
            x1="15"
            y1={slY}
            x2="405"
            y2={slY}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* Gap vertical dashed jump */}
          <line
            x1="185"
            y1="24"
            x2="185"
            y2={gapY}
            stroke="#e11d48"
            strokeWidth="2"
            strokeDasharray="3 3"
          />
          {/* Next morning open & post-open path */}
          <path
            d={`M 185 ${gapY} L 405 ${Math.min(112, gapY + 4)}`}
            stroke="#e11d48"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="185" cy={gapY} r="5" fill="#e11d48" />
        </svg>

        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Planned SL Loss</div>
            <div className="text-sm font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
              {formatINR(-plannedLoss)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Actual Gap Loss</div>
            <div className="text-sm font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
              {formatINR(-actualLoss)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="text-[10.5px] uppercase font-bold text-muted-foreground">Unplanned Slippage</div>
            <div className="text-sm font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
              {formatINR(-slippageExtra)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl border border-border bg-muted/35 p-4">
        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Planned Stop-Loss</span>
            <span className="font-mono text-amber-600 dark:text-amber-400">-{plannedSlPct}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={plannedSlPct}
            onChange={(e) => setPlannedSlPct(Number(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Overnight Gap-Down</span>
            <span className="font-mono text-rose-600 dark:text-rose-400">-{gapDownPct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={gapDownPct}
            onChange={(e) => setGapDownPct(Number(e.target.value))}
            className="w-full accent-rose-600 cursor-pointer"
          />
        </label>

        <label className="space-y-1.5 text-xs font-semibold text-foreground">
          <div className="flex justify-between">
            <span>Position Quantity</span>
            <span className="font-mono">{qty} shares</span>
          </div>
          <input
            type="range"
            min={100}
            max={1500}
            step={100}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="w-full accent-blue-600 cursor-pointer"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border bg-card p-3.5">
        <p className="text-xs text-muted-foreground">
          <strong>Key takeaway:</strong> An SL-M trigger never guarantees exit price across an
          overnight disclosure gap (e.g., IndusInd Bank Mar 2025, Paytm Feb 2024).
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onPracticeConcept(
              "A Stop-Loss Market (SL-M) order becomes a market order only once the trigger price is crossed during active market hours. It does NOT guarantee execution at the trigger price when adverse news breaks after market close and the stock gaps open far below the stop."
            )
          }
        >
          Verify This Concept <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * LAB 4: Interactive 26 Historical Indian Market Shocks Explorer
 * -------------------------------------------------------------------------- */
function HistoricalShockExplorer() {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let active = true;
    fetchHistoricalScenarios()
      .then((res) => {
        if (!active) return;
        const list = res.scenarios || [];
        setScenarios(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch((err) => {
        if (active) setError(err.message || "Could not load historical scenario bank.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered =
    filter === "all" ? scenarios : scenarios.filter((s) => s.concept_tag === filter);
  const selected = filtered.find((s) => s.id === selectedId) || filtered[0] || null;

  if (loading) {
    return (
      <div className="py-12 flex justify-center">
        <Spinner size="md" label="Loading 26 verified Indian market shocks..." />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;

  const sc = selected?.shock_chart;
  const pathD = sc?.points?.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const lastPt = sc?.points?.[sc.points.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {SHOCK_FILTERS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {selected && (
        <div className="rounded-2xl border border-rose-200/80 dark:border-rose-500/30 bg-card p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Badge variant="destructive" className="font-mono">
              <Calendar className="h-3 w-3" /> {selected.date}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10.5px]">
              {selected.concept_tag}
            </Badge>
          </div>

          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-foreground">
              {selected.event}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
              {selected.what_happened}
            </p>
          </div>

          {sc && pathD && (
            <div className="rounded-xl border border-border bg-muted/35 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono flex-wrap gap-1">
                <span className="font-semibold text-foreground">{sc.instrument}</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  {sc.headline_stat}
                </span>
              </div>
              <svg viewBox="0 0 420 118" className="w-full h-28 overflow-visible">
                <line
                  x1="10"
                  y1={sc.threshold_y}
                  x2="408"
                  y2={sc.threshold_y}
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke="#e11d48"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill="#e11d48" />}
              </svg>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-muted-foreground">{sc.pre_label}</span>
                <span className="text-amber-700 dark:text-amber-400">--- {sc.threshold_label}</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">{sc.shock_label}</span>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-3.5 space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Ground-Truth Mechanism
            </div>
            <p className="text-xs sm:text-sm text-emerald-950/90 dark:text-emerald-100/90 leading-relaxed">
              {selected.correct_reasoning_chain}
            </p>
          </div>

          {selected.source && (
            <p className="text-[11px] font-mono text-muted-foreground text-right">
              Source: {selected.source}
            </p>
          )}
        </div>
      )}

      {/* Scrollable selector list of all matching historical shocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
        {filtered.map((item) => {
          const active = selected?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                active
                  ? "border-brand-600 bg-brand-50/80 dark:bg-brand-500/15"
                  : "border-border bg-card hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-semibold text-rose-600 dark:text-rose-400">
                  {item.date}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">
                  {item.shock_chart?.instrument}
                </span>
              </div>
              <p className="text-xs font-bold text-foreground mt-0.5 line-clamp-1">{item.event}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Main RiskSandbox Screen
 * -------------------------------------------------------------------------- */
export default function RiskSandbox({ onPracticeConcept, onBack }) {
  const [activeLab, setActiveLab] = useState("options");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="default">
            <Sliders className="h-3.5 w-3.5" /> Interactive Risk-Mechanics Sandbox
          </Badge>
          <Badge variant="success">
            <Layers className="h-3.5 w-3.5" /> Visual Intuition · Zero Fake P&amp;L
          </Badge>
        </div>
        <CardTitle className="pt-1">Explore Market Risk Mechanics Live</CardTitle>
        <CardDescription>
          Drag sliders to see exactly how option writer asymmetry, MTM margin calls, overnight
          gap-downs, and 26 real Indian market shocks behave — then prove your understanding in
          Teach-Back.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {LAB_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeLab === tab.id;
            return (
              <Button
                key={tab.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setActiveLab(tab.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </Button>
            );
          })}
        </div>

        {activeLab === "options" && <OptionPayoffLab onPracticeConcept={onPracticeConcept} />}
        {activeLab === "margin" && <MarginCallLab onPracticeConcept={onPracticeConcept} />}
        {activeLab === "gap" && <GapSlippageLab onPracticeConcept={onPracticeConcept} />}
        {activeLab === "shocks" && <HistoricalShockExplorer />}
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          Educational risk-mechanics sandbox only — never investment advice.
        </span>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to Verify
        </Button>
      </CardFooter>
    </Card>
  );
}
