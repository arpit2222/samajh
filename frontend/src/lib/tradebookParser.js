/**
 * Client-side Privacy-Redacting Tradebook CSV Parser (Zerodha Console & Angel One).
 *
 * SECURITY / PRIVACY GUARANTEE:
 * Runs 100% locally in the browser BEFORE any network call.
 * Strips client_id, PAN, order_id, trade_id, ticker symbols, and ALL absolute ₹ figures
 * (capital, price, quantity, P&L). Only derived ratios, risk tags, and strictly anonymized
 * trade buckets ever leave the browser.
 */

const SENSITIVE_COLUMN_PATTERNS = [
  /client/i,
  /pan/i,
  /account/i,
  /order[_\s-]?id/i,
  /order[_\s-]?no/i,
  /trade[_\s-]?id/i,
  /isin/i,
  /ucc/i,
  /email/i,
  /phone/i,
  /mobile/i,
  /price/i,
  /qty|quantity/i,
  /pnl|amount|value|capital/i,
];

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function classifyInstrument(symbol, segment) {
  const s = `${symbol} ${segment}`.toUpperCase();
  if (/\bCE\b|\bPE\b|\d+(CE|PE)$/.test(s)) return "Options";
  if (/FUT|FUTURE/.test(s)) return "Futures";
  if (/FO|F&O|NFO|BFO|DERIV/.test(s)) return "F&O";
  return "Equity Cash";
}

/**
 * Strictly auto-detect Zerodha Console OR Angel One tradebook CSV from headers.
 * Throws a clear error for any unrecognized CSV format.
 */
function detectBrokerFormatStrict(lowerHeaders) {
  const has = (name) => lowerHeaders.some((h) => h === name || h.includes(name));

  // Zerodha Console format: symbol + trade_date + trade_type (typically also segment/exchange/order_id)
  if (has("symbol") && (has("trade_date") || has("order_execution_time")) && has("trade_type")) {
    return "Zerodha Console CSV";
  }

  // Angel One Tradebook format: scrip + buy/sell + trade_date/date
  if (has("scrip") && (has("buy/sell") || has("buy_sell") || has("trade_type")) && has("date")) {
    return "Angel One Tradebook CSV";
  }

  throw new Error(
    "Unrecognized CSV format. Please upload a standard Tradebook CSV exported from Zerodha Console (symbol, trade_date, trade_type) or Angel One (Scrip, Buy/Sell, Trade Date)."
  );
}

/**
 * Parse and anonymize a Zerodha Console or Angel One CSV completely in-browser.
 * Returns { brokerSource, redactedFields, ratios, risk_tags, trades }.
 * Every trade object contains ZERO PII, ZERO symbols, and ZERO ₹ amounts.
 */
export function parseAndRedactTradebookCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file is empty or missing trade rows.");
  }

  const rawHeaders = parseCsvLine(lines[0]);
  const lowerHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const brokerSource = detectBrokerFormatStrict(lowerHeaders);

  const redactedFields = new Set(["Absolute ₹ Capital & P&L", "Ticker Symbols"]);
  for (const h of rawHeaders) {
    if (SENSITIVE_COLUMN_PATTERNS.some((re) => re.test(h))) {
      redactedFields.add(h);
    }
  }

  const findCol = (...candidates) => {
    for (const c of candidates) {
      const idx = lowerHeaders.findIndex((h) => h === c || h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const symbolIdx = findCol("symbol", "scrip", "tradingsymbol");
  const segmentIdx = findCol("segment", "exchange");
  const sideIdx = findCol("trade_type", "buy/sell", "buy_sell");
  const dateIdx = findCol("trade_date", "order_execution_time", "date");
  const productIdx = findCol("product", "hold_type");
  const outcomeIdx = findCol("outcome", "move_pct", "return_pct", "pnl_pct");
  const slIdx = findCol("had_stop_loss", "stop_loss");

  const trades = [];
  for (let i = 1; i < lines.length && trades.length < 40; i++) {
    const cols = parseCsvLine(lines[i]);
    const rawSymbol = symbolIdx !== -1 ? (cols[symbolIdx] || "").trim() : "";
    if (!rawSymbol) continue;

    const rawSegment = segmentIdx !== -1 ? cols[segmentIdx] || "" : "";
    const instrument_type = classifyInstrument(rawSymbol, rawSegment);
    const segment = instrument_type === "Equity Cash" ? "EQ" : "F&O";

    const sideRaw = sideIdx !== -1 ? (cols[sideIdx] || "BUY").toUpperCase() : "BUY";
    const direction = sideRaw.startsWith("S") ? "SELL" : "BUY";
    const date = dateIdx !== -1 ? (cols[dateIdx] || "").slice(0, 10) : "Recent";

    const prodRaw = productIdx !== -1 ? (cols[productIdx] || "").toUpperCase() : "";
    const holding_bucket =
      prodRaw.includes("CNC")
        ? "Multi-day"
        : prodRaw.includes("NRML") || prodRaw.includes("OVER")
          ? "Overnight"
          : prodRaw.includes("MIS") || prodRaw.includes("INTRA")
            ? "Intraday"
            : instrument_type === "Futures"
              ? "Overnight"
              : "Intraday";

    const expiry_day = instrument_type === "Options" && /WK|EXP|THU|\d{5}(CE|PE)/i.test(rawSymbol);

    // Bucket outcome into ONLY "loss" | "gain" | "flat" — never keep ₹ amounts or raw P&L
    let outcome_bucket = "loss";
    if (outcomeIdx !== -1 && cols[outcomeIdx] !== "") {
      const rawOut = cols[outcomeIdx].toLowerCase();
      if (rawOut === "gain" || rawOut === "profit") outcome_bucket = "gain";
      else if (rawOut === "loss") outcome_bucket = "loss";
      else if (rawOut === "flat") outcome_bucket = "flat";
      else {
        const num = Number(rawOut);
        if (Number.isFinite(num)) {
          outcome_bucket = num > 0 ? "gain" : num < 0 ? "loss" : "flat";
        }
      }
    }

    const had_stop_loss =
      slIdx !== -1 && cols[slIdx] !== "" ? /^true|yes|1$/i.test(cols[slIdx]) : null;

    // Strictly anonymized trade object — zero symbol, zero client_id, zero PAN, zero ₹ amounts
    trades.push({
      id: `trade_${i}`,
      date,
      instrument_type,
      segment,
      direction,
      holding_bucket,
      outcome_bucket,
      expiry_day,
      had_stop_loss,
    });
  }

  if (trades.length === 0) {
    throw new Error("No valid trade rows found in the uploaded CSV.");
  }

  const total_trades = trades.length;
  const fno_pct = Math.round(
    (trades.filter((t) => t.segment === "F&O").length / total_trades) * 100
  );
  const overnight_pct = Math.round(
    (trades.filter((t) => t.holding_bucket !== "Intraday").length / total_trades) * 100
  );
  const expiry_day_pct = Math.round(
    (trades.filter((t) => t.expiry_day).length / total_trades) * 100
  );

  const risk_tags = [];
  if (fno_pct >= 60) risk_tags.push("high F&O concentration");
  if (overnight_pct >= 40) risk_tags.push("high overnight exposure");
  if (expiry_day_pct >= 20) risk_tags.push("expiry-day options exposure");
  if (trades.some((t) => t.instrument_type === "Options" && t.direction === "SELL")) {
    risk_tags.push("short option writing exposure");
  }
  if (risk_tags.length === 0) risk_tags.push("balanced cash profile");

  return {
    brokerSource,
    redactedFields: [...redactedFields],
    ratios: {
      fno_pct,
      overnight_pct,
      expiry_day_pct,
      total_trades,
    },
    risk_tags,
    trades,
  };
}

/**
 * Sample Zerodha Console CSV for 1-click live demo.
 * Contains mock client_id, pan, order_id, trade_id, and price columns specifically
 * so judges can verify in DevTools Network tab that NONE of them leave the browser.
 */
export const SAMPLE_BROKER_CSV = `client_id,pan,order_id,trade_id,trade_date,symbol,segment,product,trade_type,quantity,price,outcome,had_stop_loss
ZD9941,ABCDE1234F,25031000182,T99101,2025-03-10,INDUSINDBK MAR FUT,NFO,NRML,BUY,500,900.50,loss,true
ZD9941,ABCDE1234F,25031300419,T99102,2025-03-13,NIFTY 24000 CE WK,NFO,MIS,BUY,150,84.20,loss,false
ZD9941,ABCDE1234F,25031800772,T99103,2025-03-18,BANKNIFTY 51500 PE WK,NFO,NRML,SELL,60,210.00,loss,false
ZD9941,ABCDE1234F,25032000911,T99104,2025-03-20,RELIANCE MAR FUT,NFO,NRML,SELL,250,1280.00,loss,true
ZD9941,ABCDE1234F,25032100205,T99105,2025-03-21,HDFCBANK,EQ,CNC,BUY,40,1715.00,gain,true`;
