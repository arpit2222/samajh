/**
 * Extensible regional Indian language registry for Samajh frontend (Capture + Teach-Back Voice/Text).
 * Matches backend/src/tools/languages.js.
 */
export const SUPPORTED_LANGUAGES = [
  {
    code: "en-IN",
    label: "English (India)",
    nativeLabel: "English",
    speechLang: "en-IN",
    placeholder:
      "Point out what they got wrong and explain how the mechanism actually works... (⌘/Ctrl + Enter)",
  },
  {
    code: "hi-IN",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    speechLang: "hi-IN",
    placeholder:
      "हिन्दी में समझाएं कि नौसिखिए ने क्या गलत समझा और असली बाज़ार तंत्र कैसे काम करता है... (⌘/Ctrl + Enter)",
  },
];

export const DEFAULT_LANGUAGE_CODE = "en-IN";

export function getLanguageConfig(code) {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code === code) ||
    SUPPORTED_LANGUAGES[0]
  );
}
