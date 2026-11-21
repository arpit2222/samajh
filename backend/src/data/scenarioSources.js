/**
 * Verified Public Source Citations for all 26 entries in `scenarioBank.json`.
 *
 * INVARIANT: Zero LLM-invented or synthetic market events. Every dated scenario
 * corresponds to a real, publicly documented Indian market event:
 *
 *  1. sc_2020_03_23_covid_circuit_2    — 2020-03-23 | NSE India / Economic Times (COVID 2nd 10% lower circuit halt, Sensex -13.15%)
 *  2. sc_2025_03_10_indusind_gap       — 2025-03-10 | NSE India / LiveMint (IndusInd Bank derivatives accounting disclosure, -27% intraday)
 *  3. sc_2024_06_04_election_vix       — 2024-06-04 | NSE India / The Hindu (Lok Sabha results shock, Nifty -5.93%, VIX > 28)
 *  4. sc_2020_03_06_yesbank_moratorium — 2020-03-06 | RBI Press Release / Economic Times (Yes Bank moratorium, -85% intraday)
 *  5. sc_2020_03_13_covid_circuit_1    — 2020-03-13 | NSE India / Business Today (COVID 1st 10% lower circuit halt, 45-min freeze)
 *  6. sc_2020_03_12_who_pandemic       — 2020-03-12 | LiveMint / The Hindu (WHO pandemic declaration, Sensex -8.18%, Nifty -8.30%)
 *  7. sc_2004_05_17_black_monday_circuits — 2004-05-17 | CNN / Economic Times (2004 election shock, 10% lower circuit, close -11.1%)
 *  8. sc_2008_01_22_gfc_lower_circuit  — 2008-01-22 | NSE India / Economic Times (Subprime rout, opening 10% Nifty lower circuit)
 *  9. sc_2009_05_18_upa_upper_circuit  — 2009-05-18 | NSE India / Business Standard (UPA landslide, 15% & 20% upper circuits, +17.24%)
 * 10. sc_2008_10_24_gfc_black_friday   — 2008-10-24 | Economic Times / Rediff (GFC Black Friday, Sensex -10.96%)
 * 11. sc_2021_02_24_nse_outage         — 2021-02-24 | NSE Circular / The News Minute (NSE telecom failure, 4-hr halt at 14,820.45)
 * 12. sc_2009_01_07_satyam_fraud       — 2009-01-07 | Economic Times (Satyam ₹7,000+ Cr fraud confession, stock -78%, Sensex -7.25%)
 * 13. sc_2018_09_21_dhfl_nbfc_shock    — 2018-09-21 | New Indian Express (DHFL/IL&FS NBFC panic, DHFL -59.67% intraday)
 * 14. sc_2024_02_01_paytm_rbi_curb     — 2024-02-01 | RBI Press Release / India Today (Paytm Payments Bank curbs, -20% lower circuit)
 * 15. sc_2023_01_27_adani_hindenburg   — 2023-01-27 | Al Jazeera / NSE Data (Hindenburg report rout, Adani Enterprises -18.52%, -20% circuits)
 * 16. sc_2018_02_15_pnb_fraud          — 2018-02-15 | LiveMint (PNB ₹11,400 Cr Nirav Modi LoU fraud, PNB ~-12%)
 * 17. sc_2020_11_18_lvb_moratorium     — 2020-11-18 | RBI / New Indian Express (Lakshmi Vilas Bank moratorium, -19.94% lower circuit)
 * 18. sc_2019_09_20_corp_tax_cut       — 2019-09-20 | The News Minute / Factly (Corporate tax cut, Sensex +1,921.15 pts / +5.32%)
 * 19. sc_2022_02_24_ukraine_invasion   — 2022-02-24 | Indian Express (Russia-Ukraine invasion on expiry day, Nifty -4.78%)
 * 20. sc_2024_08_05_yen_carry_unwind   — 2024-08-05 | New Indian Express / Financial Express (Yen carry-trade unwind, Sensex -2.74%)
 * 21. sc_2015_08_24_china_black_monday — 2015-08-24 | Financial Express / New Indian Express (China devaluation rout, Sensex -5.94%)
 * 22. sc_2016_11_09_demonetization_shock — 2016-11-09 | Groww / Historical Market Archive (Demonetization + US election shock, ~-2% close)
 * 23. sc_2016_06_24_brexit_shock       — 2016-06-24 | New Indian Express / Forbes India (Brexit surprise vote, Sensex -604.51 pts / -2.24%)
 * 24. sc_2020_02_01_budget_selloff     — 2020-02-01 | The Hindu / India Today (Union Budget 2020 selloff, Sensex -987.96 pts / -2.43%)
 * 25. sc_2021_11_26_omicron_selloff    — 2021-11-26 | Indian Express / LiveMint (Omicron variant selloff, Sensex -2.87%, Nifty -2.91%)
 * 26. sc_2025_04_07_us_tariff_shock    — 2025-04-07 | The Hindu / Angel One (US reciprocal tariff shock, Nifty -3.24%, Sensex -2.95%)
 * 27. sc_general_market_risk_fallback  — General Market Stress | SEBI Peak-Margin & NISM Series VIII Framework (catch-all fallback)
 */
export const VERIFIED_SCENARIO_COUNT_MIN = 25;
