/**
 * NISM Module Registry & Strictly Separated Taxonomies.
 *
 * Series VIII (Equity Derivatives) remains the default module and its taxonomy is
 * NEVER overloaded with mutual-fund concepts. Series V-A maintains its own
 * dedicated weak_subtopic taxonomy and workbook corpus.
 */
export const DEFAULT_NISM_MODULE = "series-viii";

export const SERIES_VA_WEAK_SUBTOPICS = Object.freeze([
  "nav_cutoff_valuation_misconception",
  "ter_direct_regular_exit_load",
  "debt_fund_duration_credit_risk",
  "idcw_vs_growth_sip_mechanics",
  "sebi_scheme_categorization_riskometer",
]);

export const SERIES_I_WEAK_SUBTOPICS = Object.freeze([
  "currency_forward_interest_rate_parity",
  "fbil_reference_rate_cash_settlement",
  "exporter_importer_hedge_basis_risk",
  "currency_option_european_asymmetry",
  "currency_margin_position_limits",
]);

export const NISM_MODULES = Object.freeze({
  "series-viii": {
    id: "series-viii",
    label: "NISM Series VIII",
    subtitle: "Equity Derivatives",
    hasStressTest: true,
    corpusFile: "nismWorkbookCorpus.json",
  },
  "series-va": {
    id: "series-va",
    label: "NISM Series V-A",
    subtitle: "Mutual Fund Distributors",
    hasStressTest: false, // Mutual funds do not use F&O historical-shock stress tests yet
    corpusFile: "nismSeries5ACorpus.json",
    weakSubtopics: SERIES_VA_WEAK_SUBTOPICS,
  },
  "series-i": {
    id: "series-i",
    label: "NISM Series I",
    subtitle: "Currency Derivatives",
    hasStressTest: false, // Dedicated currency module scoped to workbook-grounded teach-back
    corpusFile: "nismSeries1Corpus.json",
    weakSubtopics: SERIES_I_WEAK_SUBTOPICS,
  },
});

export function resolveNismModule(requestedModule) {
  if (requestedModule === undefined || requestedModule === null || requestedModule === "") {
    return NISM_MODULES[DEFAULT_NISM_MODULE];
  }
  const normalized = String(requestedModule).trim().toLowerCase();
  const entry = NISM_MODULES[normalized];
  if (!entry) {
    const err = new Error(
      `Unsupported NISM module "${normalized}". Supported modules: ${Object.keys(NISM_MODULES).join(", ")}.`
    );
    err.statusCode = 400;
    throw err;
  }
  return entry;
}
