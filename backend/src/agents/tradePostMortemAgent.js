import { callGeminiJSON } from "./geminiClient.js";
import { retrieveNismGrounding, formatGroundingBlock } from "../tools/nismGrounding.js";

/**
 * Canonical concept catalog mapping concept_tag -> verified NISM concept + analogy
 * so the "Verify this concept now" loop-back can seed socraticAgent directly
 * without calling ingestAgent or conceptAgent.
 */
export const CONCEPT_TAG_MAP = {
  overnight_gap_stoploss_risk: {
    concept_name: "Stop-Loss & Overnight Gap Risk",
    concept:
      "Stop-Loss & Overnight Gap Risk: A Stop-Loss Market (SL-M) order converts into a market order only after the trigger is hit during active market hours — it does NOT guarantee execution at the trigger price when a security gaps straight through it at the next morning's open.",
    analogy:
      "A stop-loss is like an alarm bell that wakes you up to sell — if the market opens 20% lower overnight, the bell rings after the floor has already dropped out beneath you.",
  },
  circuit_breaker_margin_risk: {
    concept_name: "Mark-to-Market (MTM) Margin & Circuit Halts",
    concept:
      "Mark-to-Market (MTM) Margin & Circuit Halts: Leveraged F&O positions are marked-to-market daily in cash against settlement prices; during a sharp adverse move or circuit-breaker halt, you cannot exit while margin requirements spike on reopen, triggering forced broker square-offs.",
    analogy:
      "Think of MTM margin like settling your tab every single evening at a broker's desk — if a storm locks the doors during a halt, you cannot walk out, and your bill jumps the moment doors reopen.",
  },
  event_volatility_option_writing_risk: {
    concept_name: "Option Buyer vs Writer Payoff Asymmetry & Expiry Decay",
    concept:
      "Option Buyer vs Writer Payoff Asymmetry & Expiry Decay: Option buyers face rapid theta (time-value) decay on expiry day, while option writers face asymmetric, theoretically unlimited downside and sudden vega/margin expansion during volatility spikes.",
    analogy:
      "Buying expiry-day OTM options is like holding an ice cube in Indian summer heat; writing naked options is like collecting small insurance premiums while standing in the path of a cyclone.",
  },
  regulatory_moratorium_liquidity_risk: {
    concept_name: "Liquidity Evaporation & Tail-Risk Collateral Shock",
    concept:
      "Liquidity Evaporation & Tail-Risk Collateral Shock: During extreme regulatory or solvency shocks, order-book depth vanishes, pledged margin collateral suffers steep haircuts, and leveraged positions cannot be exited anywhere near prior screen prices.",
    analogy:
      "Liquidity in calm markets is like a wide highway — in a solvency shock, every lane collapses into a single exit door while everyone tries to leave at once.",
  },
};

export const VALID_CONCEPT_TAGS = Object.keys(CONCEPT_TAG_MAP);

const postMortemSchema = {
  type: "OBJECT",
  properties: {
    diagnosis: {
      type: "STRING",
      description:
        "2 to 4 crisp sentences diagnosing ONLY the structural/risk-management mistake pattern in this anonymized trade (e.g., high expiry-day options exposure without understanding time-decay risk). NEVER give buy/sell/hold/exit advice, NEVER predict price direction, and NEVER discuss any specific security's future outlook.",
    },
    concept_tag: {
      type: "STRING",
      enum: VALID_CONCEPT_TAGS,
      description:
        "Exact concept_tag from the allowed Samajh concept list that matches the structural knowledge gap exposed by this trade.",
    },
  },
  required: ["diagnosis", "concept_tag"],
};

/**
 * tradePostMortemAgent
 * Diagnoses ONLY structural/risk mistake patterns from strictly anonymized trade metadata
 * and behavioral ratios (zero PII, zero ₹ amounts), grounded in NISM workbook references.
 * Returns { diagnosis, concept_tag, concept_name, grounding }.
 */
export async function tradePostMortemAgent({
  trade,
  ratios = null,
  risk_tags = [],
  note = "",
} = {}) {
  if (!trade || !trade.instrument_type) {
    const err = new Error("Select an anonymized past trade to diagnose.");
    err.statusCode = 400;
    throw err;
  }

  const queryText = [
    trade.instrument_type,
    trade.segment,
    trade.direction,
    trade.holding_bucket,
    trade.outcome_bucket,
    trade.expiry_day ? "expiry day option theta decay" : "",
    trade.had_stop_loss ? "stop-loss overnight gap" : "margin risk",
    ...(Array.isArray(risk_tags) ? risk_tags : []),
    note,
  ]
    .filter(Boolean)
    .join(" ");

  const grounding = await retrieveNismGrounding(queryText, 2);
  const groundingBlock = formatGroundingBlock(grounding);

  const parsed = await callGeminiJSON({
    systemInstruction:
      "You are the Risk-Literacy Post-Mortem Agent for Samajh ('Learn it. Prove it.'), an Indian NISM & retail F&O " +
      "understanding verifier. You receive ONLY anonymized trade attributes and behavioral risk ratios (zero PII, zero ₹ amounts).\n\n" +
      "HARD COMPLIANCE RULES (NEVER VIOLATE):\n" +
      "1. Diagnose ONLY the structural / risk-management mistake pattern (e.g., overnight gap risk on leveraged holds, " +
      "expiry-day theta decay, naked option writing asymmetry, margin call exposure).\n" +
      "2. NEVER recommend a specific market action (buy, sell, hold, exit, enter, average down).\n" +
      "3. NEVER predict price movement or comment on any security's future outlook.\n" +
      "4. If an honest diagnosis would require making a directional market call, name the underlying NISM risk concept gap instead and stop there.\n" +
      "5. Map the diagnosis to the single best matching `concept_tag` from the allowed enum.",
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `ANONYMIZED TRADE ATTRIBUTES:\n${JSON.stringify(trade, null, 2)}\n\n` +
              (ratios
                ? `ANONYMIZED BEHAVIORAL RATIOS:\n${JSON.stringify({ ...ratios, risk_tags }, null, 2)}\n\n`
                : "") +
              (note?.trim() ? `TRADER'S OPTIONAL NOTE:\n"${note.trim()}"\n\n` : "") +
              (groundingBlock ? `NISM WORKBOOK REFERENCES:\n${groundingBlock}\n\n` : "") +
              "Return a structural risk-literacy diagnosis (zero investment advice) and the matching concept_tag.",
          },
        ],
      },
    ],
    responseSchema: postMortemSchema,
  });

  const tag = CONCEPT_TAG_MAP[parsed.concept_tag]
    ? parsed.concept_tag
    : "circuit_breaker_margin_risk";

  return {
    diagnosis: String(parsed.diagnosis || "").trim(),
    concept_tag: tag,
    concept_name: CONCEPT_TAG_MAP[tag].concept_name,
    grounding: {
      engine: grounding.engine,
      citations: grounding.passages.map((p) => ({
        id: p.id,
        source: p.source,
        topic: p.topic,
      })),
    },
  };
}
