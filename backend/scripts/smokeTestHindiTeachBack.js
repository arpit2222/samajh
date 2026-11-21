import assert from "node:assert/strict";
import { initDatabase, createSession, getSession } from "../src/db/firestore.js";
import { resolveLanguage, SUPPORTED_LANGUAGES } from "../src/tools/languages.js";
import { retrieveNismGrounding } from "../src/tools/nismGrounding.js";
import { SUPPORTED_LANGUAGES as FRONTEND_LANGUAGES } from "../../frontend/src/lib/languages.js";

async function runHindiProof() {
  process.env.MONGO_CONNECTION_STRING = "";
  await initDatabase();

  // 1. Language registry parity between backend and frontend
  const backendCodes = Object.keys(SUPPORTED_LANGUAGES).sort();
  const frontendCodes = FRONTEND_LANGUAGES.map((l) => l.code).sort();
  assert.deepEqual(
    backendCodes,
    frontendCodes,
    "Backend and frontend supported language registries must match"
  );
  assert.ok(backendCodes.includes("en-IN") && backendCodes.includes("hi-IN"));

  // 2. Hindi config has Devanagari instructions + explicit NISM citation non-translation rule
  const hi = resolveLanguage("hi-IN");
  assert.equal(hi.speechLang, "hi-IN");
  assert.match(hi.socraticInstruction, /Hindi/i);
  assert.match(hi.socraticInstruction, /NEVER silently switch to English/i);
  assert.match(hi.examinerInstruction, /NEVER translate the official NISM workbook citation text/i);

  // 3. Unsupported language throws 400 (NEVER silently falls back to English)
  assert.throws(
    () => resolveLanguage("xx-INVALID"),
    (err) => err.statusCode === 400 && /Unsupported language/i.test(err.message),
    "Unsupported language must throw 400 rather than silently falling back to English"
  );

  // 4. Session persists language: "hi-IN"
  const sessionId = "sess_hindi_proof_001";
  await createSession({
    sessionId,
    uid: "trader_hi_01",
    language: "hi-IN",
    concept: "Mark-to-Market (MTM) Daily Cash Settlement",
    turns: [],
  });
  const stored = await getSession(sessionId);
  assert.equal(stored.language, "hi-IN", "Session must persist selected language");

  // 5. NISM citations remain in original English form regardless of Hindi UI/query
  const grounding = await retrieveNismGrounding(
    "Mark-to-Market MTM margin daily settlement futures",
    2
  );
  assert.ok(grounding.passages.length > 0, "NISM grounding must return citations");
  for (const p of grounding.passages) {
    assert.match(p.source, /NISM/i, "NISM citation source must remain in original English");
    // Ensure no Devanagari characters mutated the official citation source
    assert.ok(
      !/[\u0900-\u097F]/.test(p.source),
      "Official NISM citation source must never be translated"
    );
  }

  console.log("✅ Regional Language (Hindi hi-IN) Teach-Back smoke test passed!");
  console.log("   - Extensible en-IN + hi-IN registry matched across backend & frontend");
  console.log("   - Unsupported language throws 400 (zero silent English fallback)");
  console.log("   - Session persists language='hi-IN' for SocraticAgent, ExaminerAgent & Web Speech API");
  console.log("   - Official NISM workbook citations preserved verbatim in English");
}

runHindiProof().catch((err) => {
  console.error("❌ Regional Language smoke test failed:", err);
  process.exit(1);
});
