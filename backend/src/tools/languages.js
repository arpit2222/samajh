/**
 * Extensible regional Indian language registry for Samajh Teach-Back & Examiner feedback.
 * To add more Indian languages (e.g. mr-IN, ta-IN, gu-IN, bn-IN, te-IN), append an entry here.
 *
 * INVARIANT: NISM workbook citations are ALWAYS kept in their original English form;
 * only the surrounding conversational dialogue and examiner rationale use the selected language.
 */
export const SUPPORTED_LANGUAGES = Object.freeze({
  "en-IN": {
    code: "en-IN",
    label: "English (India)",
    nativeLabel: "English",
    speechLang: "en-IN",
    socraticInstruction: "Respond in clear, natural Indian English.",
    examinerInstruction:
      "Write `rationale` in clear, natural Indian English. Keep official NISM workbook citations verbatim in English.",
  },
  "hi-IN": {
    code: "hi-IN",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    speechLang: "hi-IN",
    socraticInstruction:
      "You MUST respond in natural conversational Hindi (Devanagari script, e.g., 'अच्छा, तो क्या इसका मतलब है कि...'). " +
      "Standard market terms like NISM, MTM, F&O, stop-loss, or margin may remain in standard usage inside Hindi sentences, " +
      "but your sentences MUST be in Hindi — NEVER silently switch to English.",
    examinerInstruction:
      "You MUST write `rationale` in clear, evidence-based Hindi (Devanagari script) explaining what the learner got right and what mechanism gap cost them points. " +
      "CRITICAL: NEVER translate the official NISM workbook citation text itself — keep NISM source names/citations verbatim in original English and explain around them in Hindi. " +
      "Keep `weak_subtopic` concise in English or standard NISM mechanism terminology so downstream stress-test scenario matching stays accurate.",
  },
});

export const DEFAULT_LANGUAGE = "en-IN";

/**
 * Resolves and validates a requested language code.
 * Throws a 400 error for unsupported languages rather than silently falling back to English.
 */
export function resolveLanguage(requestedCode) {
  if (requestedCode === undefined || requestedCode === null || requestedCode === "") {
    return SUPPORTED_LANGUAGES[DEFAULT_LANGUAGE];
  }
  const normalized = String(requestedCode).trim();
  const entry = SUPPORTED_LANGUAGES[normalized];
  if (!entry) {
    const supportedList = Object.keys(SUPPORTED_LANGUAGES).join(", ");
    const err = new Error(
      `Unsupported language "${normalized}". Supported Teach-Back languages are: ${supportedList}.`
    );
    err.statusCode = 400;
    throw err;
  }
  return entry;
}
