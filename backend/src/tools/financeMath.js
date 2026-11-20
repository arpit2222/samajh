/**
 * Deterministic financial calculator — the single source of truth for every
 * number Samajh shows a user. Gemini may CHOOSE a calculation type and its
 * inputs, but it never produces the resulting figures as prose.
 *
 * Every calculation returns:
 *   { calc_type, inputs, outputs, summary }
 * where `summary` is a template filled ONLY with computed values.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const formatINR = (n) => {
  const v = round2(n);
  const sign = v < 0 ? "-" : "";
  return `${sign}₹${Math.abs(v).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const pct = (n) => `${round2(n)}%`;

function requirePositive(inputs, keys) {
  for (const k of keys) {
    const v = Number(inputs[k]);
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`financeMath: input "${k}" must be a positive number (got ${inputs[k]}).`);
    }
  }
}

/**
 * Long futures position hit by an adverse move: MTM loss vs. posted margin.
 * inputs: { entry_price, lot_size, lots, margin_pct, adverse_move_pct, maintenance_pct? }
 */
function futuresMtmMarginCall(inputs) {
  requirePositive(inputs, ["entry_price", "lot_size", "lots", "margin_pct", "adverse_move_pct"]);
  const entry = Number(inputs.entry_price);
  const qty = Number(inputs.lot_size) * Number(inputs.lots);
  const marginPct = Number(inputs.margin_pct);
  const movePct = Number(inputs.adverse_move_pct);
  const maintenancePct = Number(inputs.maintenance_pct ?? marginPct * 0.75);

  const notional = entry * qty;
  const initialMargin = (notional * marginPct) / 100;
  const newPrice = entry * (1 - movePct / 100);
  const mtmLoss = (entry - newPrice) * qty;
  const remainingMargin = initialMargin - mtmLoss;
  const maintenanceRequired = (newPrice * qty * maintenancePct) / 100;
  const marginCall = Math.max(0, initialMargin - remainingMargin);
  const lossAsPctOfMargin = (mtmLoss / initialMargin) * 100;
  const breachesMaintenance = remainingMargin < maintenanceRequired;

  const outputs = {
    quantity: qty,
    notional: round2(notional),
    initial_margin: round2(initialMargin),
    new_price: round2(newPrice),
    mtm_loss: round2(mtmLoss),
    remaining_margin: round2(remainingMargin),
    maintenance_required: round2(maintenanceRequired),
    top_up_to_restore_initial: round2(marginCall),
    loss_as_pct_of_margin: round2(lossAsPctOfMargin),
    breaches_maintenance: breachesMaintenance,
  };

  return {
    outputs,
    summary:
      `A ${pct(movePct)} adverse move on ${qty} units bought at ${formatINR(entry)} ` +
      `(notional ${formatINR(notional)}, initial margin ${formatINR(initialMargin)}) ` +
      `creates an MTM loss of ${formatINR(mtmLoss)} — ${pct(lossAsPctOfMargin)} of the margin posted. ` +
      (breachesMaintenance
        ? `Remaining margin of ${formatINR(remainingMargin)} is below the ${formatINR(maintenanceRequired)} maintenance level, so a margin call / square-off is triggered.`
        : `Remaining margin of ${formatINR(remainingMargin)} stays above the ${formatINR(maintenanceRequired)} maintenance level.`),
  };
}

/**
 * Stop-loss gapped through at the open.
 * inputs: { prev_close, quantity, stop_loss_pct, gap_open_pct }
 */
function stoplossGapSlippage(inputs) {
  requirePositive(inputs, ["prev_close", "quantity", "stop_loss_pct", "gap_open_pct"]);
  const prevClose = Number(inputs.prev_close);
  const qty = Number(inputs.quantity);
  const slPct = Number(inputs.stop_loss_pct);
  const gapPct = Number(inputs.gap_open_pct);

  const stopPrice = prevClose * (1 - slPct / 100);
  const openPrice = prevClose * (1 - gapPct / 100);
  const fillPrice = Math.min(stopPrice, openPrice);
  const plannedLoss = (prevClose - stopPrice) * qty;
  const actualLoss = (prevClose - fillPrice) * qty;
  const slippage = actualLoss - plannedLoss;
  const lossMultiple = plannedLoss > 0 ? actualLoss / plannedLoss : 0;

  const outputs = {
    stop_price: round2(stopPrice),
    open_price: round2(openPrice),
    fill_price: round2(fillPrice),
    planned_loss: round2(plannedLoss),
    actual_loss: round2(actualLoss),
    slippage: round2(slippage),
    loss_multiple: round2(lossMultiple),
    gapped_through: openPrice < stopPrice,
  };

  return {
    outputs,
    summary:
      `With ${qty} shares from a ${formatINR(prevClose)} close and a stop at ${formatINR(stopPrice)} (${pct(slPct)} below), ` +
      `the planned maximum loss was ${formatINR(plannedLoss)}. A ${pct(gapPct)} gap opens the stock at ${formatINR(openPrice)}, ` +
      `so the stop fills at the open, not the trigger: actual loss ${formatINR(actualLoss)} — ` +
      `${round2(lossMultiple)}× the planned risk (${formatINR(slippage)} of slippage).`,
  };
}

/**
 * Index futures position frozen during a circuit-breaker halt, then marked lower on reopen.
 * inputs: { prev_close, lot_size, lots, margin_pct, halt_trigger_pct, close_move_pct }
 */
function circuitHaltMarginSpike(inputs) {
  requirePositive(inputs, [
    "prev_close",
    "lot_size",
    "lots",
    "margin_pct",
    "halt_trigger_pct",
    "close_move_pct",
  ]);
  const prevClose = Number(inputs.prev_close);
  const qty = Number(inputs.lot_size) * Number(inputs.lots);
  const marginPct = Number(inputs.margin_pct);
  const haltPct = Number(inputs.halt_trigger_pct);
  const closePct = Number(inputs.close_move_pct);

  const initialMargin = (prevClose * qty * marginPct) / 100;
  const haltPrice = prevClose * (1 - haltPct / 100);
  const closePrice = prevClose * (1 - closePct / 100);
  const lossAtHalt = (prevClose - haltPrice) * qty;
  const lossAtClose = (prevClose - closePrice) * qty;
  const extraLossAfterReopen = lossAtClose - lossAtHalt;

  const outputs = {
    quantity: qty,
    initial_margin: round2(initialMargin),
    halt_price: round2(haltPrice),
    close_price: round2(closePrice),
    loss_at_halt: round2(lossAtHalt),
    loss_at_close: round2(lossAtClose),
    extra_loss_after_reopen: round2(extraLossAfterReopen),
    loss_at_close_pct_of_margin: round2((lossAtClose / initialMargin) * 100),
  };

  return {
    outputs,
    summary:
      `A long position of ${qty} units from ${formatINR(prevClose)} posts ${formatINR(initialMargin)} margin (${pct(marginPct)}). ` +
      `At the ${pct(haltPct)} circuit (${formatINR(haltPrice)}) the MTM loss is already ${formatINR(lossAtHalt)}, and nothing can be exited during the halt. ` +
      `When trading resumes and the index closes ${pct(closePct)} down (${formatINR(closePrice)}), the loss reaches ${formatINR(lossAtClose)} — ` +
      `${pct(outputs.loss_at_close_pct_of_margin)} of the original margin, with ${formatINR(extraLossAfterReopen)} added after the reopen.`,
  };
}

/**
 * Option payoff at expiry for a single leg.
 * inputs: { side: "long"|"short", option_type: "call"|"put", strike, premium, lot_size, lots, spot_at_expiry }
 */
function optionPayoff(inputs) {
  requirePositive(inputs, ["strike", "premium", "lot_size", "lots", "spot_at_expiry"]);
  const side = inputs.side === "short" ? "short" : "long";
  const type = inputs.option_type === "put" ? "put" : "call";
  const strike = Number(inputs.strike);
  const premium = Number(inputs.premium);
  const qty = Number(inputs.lot_size) * Number(inputs.lots);
  const spot = Number(inputs.spot_at_expiry);

  const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const longPnlPerUnit = intrinsic - premium;
  const pnlPerUnit = side === "long" ? longPnlPerUnit : -longPnlPerUnit;
  const pnl = pnlPerUnit * qty;
  const breakeven = type === "call" ? strike + premium : strike - premium;
  const premiumAmount = premium * qty;

  const outputs = {
    quantity: qty,
    intrinsic_per_unit: round2(intrinsic),
    breakeven: round2(breakeven),
    premium_amount: round2(premiumAmount),
    pnl: round2(pnl),
    max_loss:
      side === "long" ? round2(-premiumAmount) : type === "call" ? "unlimited" : round2(-(strike - premium) * qty),
  };

  return {
    outputs,
    summary:
      `${side === "long" ? "Buying" : "Writing"} ${qty} units of the ${strike} ${type} at ${formatINR(premium)} ` +
      `(premium ${formatINR(premiumAmount)}, breakeven ${formatINR(breakeven)}): with spot at ${formatINR(spot)} on expiry, ` +
      `the P&L is ${formatINR(pnl)}. Maximum loss: ${
        typeof outputs.max_loss === "string" ? "unlimited" : formatINR(outputs.max_loss)
      }.`,
  };
}

export const CALCULATORS = {
  futures_mtm_margin_call: futuresMtmMarginCall,
  stoploss_gap_slippage: stoplossGapSlippage,
  circuit_halt_margin_spike: circuitHaltMarginSpike,
  option_payoff: optionPayoff,
};

export const CALC_TYPES = Object.keys(CALCULATORS);

/**
 * Python source used for independent cross-verification inside ADK's
 * BuiltInCodeExecutor (Gemini's sandboxed Python). Mirrors the JS formulas.
 */
export const PYTHON_FORMULAS = {
  futures_mtm_margin_call: `
entry=i["entry_price"]; qty=i["lot_size"]*i["lots"]; m=i["margin_pct"]; mv=i["adverse_move_pct"]
initial_margin=entry*qty*m/100; new_price=entry*(1-mv/100); mtm_loss=(entry-new_price)*qty
out={"initial_margin":round(initial_margin,2),"mtm_loss":round(mtm_loss,2),"remaining_margin":round(initial_margin-mtm_loss,2)}`,
  stoploss_gap_slippage: `
pc=i["prev_close"]; q=i["quantity"]; sl=i["stop_loss_pct"]; g=i["gap_open_pct"]
stop=pc*(1-sl/100); op=pc*(1-g/100); fill=min(stop,op)
out={"planned_loss":round((pc-stop)*q,2),"actual_loss":round((pc-fill)*q,2),"slippage":round((stop-fill)*q,2)}`,
  circuit_halt_margin_spike: `
pc=i["prev_close"]; q=i["lot_size"]*i["lots"]; m=i["margin_pct"]; h=i["halt_trigger_pct"]; c=i["close_move_pct"]
out={"initial_margin":round(pc*q*m/100,2),"loss_at_halt":round(pc*h/100*q,2),"loss_at_close":round(pc*c/100*q,2)}`,
  option_payoff: `
k=i["strike"]; p=i["premium"]; q=i["lot_size"]*i["lots"]; s=i["spot_at_expiry"]
intr=max(0,s-k) if i.get("option_type","call")=="call" else max(0,k-s)
pnl=(intr-p)*q
if i.get("side","long")=="short": pnl=-pnl
out={"pnl":round(pnl,2)}`,
};

export function computeFinancialCheck(calcType, inputs = {}) {
  const fn = CALCULATORS[calcType];
  if (!fn) {
    throw new Error(`financeMath: unknown calc_type "${calcType}".`);
  }
  const { outputs, summary } = fn(inputs);
  return { calc_type: calcType, inputs, outputs, summary };
}

/**
 * Compare JS outputs against Python outputs on overlapping keys (₹0.05 tolerance).
 */
export function crossCheckOutputs(jsOutputs, pyOutputs) {
  if (!pyOutputs || typeof pyOutputs !== "object") return { matched: false, compared: [] };
  const compared = [];
  for (const [key, pyVal] of Object.entries(pyOutputs)) {
    const jsVal = jsOutputs[key];
    if (typeof pyVal === "number" && typeof jsVal === "number") {
      compared.push({ key, js: jsVal, python: pyVal, ok: Math.abs(jsVal - pyVal) <= 0.05 });
    }
  }
  return { matched: compared.length > 0 && compared.every((c) => c.ok), compared };
}
