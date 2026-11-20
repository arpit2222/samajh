import { callGeminiJSON } from "./geminiClient.js";

const ingestResponseSchema = {
  type: "OBJECT",
  properties: {
    could_read: {
      type: "BOOLEAN",
      description:
        "Set true ONLY if substantive, readable study text is clearly legible in the photo. Set false if blurry, dark, blank, or not readable study content — never guess.",
    },
    raw_text: {
      type: "STRING",
      description:
        "Verbatim transcription of substantive study content (definitions, formulas, examples, tables). Empty string if could_read is false.",
    },
    reason: {
      type: "STRING",
      description:
        "If could_read is false, a brief user-friendly reason (e.g. 'Image is too blurry to read the formulas'). Otherwise empty string.",
    },
  },
  required: ["could_read", "raw_text", "reason"],
};

/**
 * 1. ingestAgent({ imageBase64?, mimeType?, text? }) -> { raw_text }
 *
 * If imageBase64 is provided, sends it as inline_data directly to Gemini REST API
 * with instructions to transcribe only substantive study content and set could_read:false
 * (never guessing) if unreadable.
 * If only text is provided, skips the Gemini call and returns it directly.
 */
export async function ingestAgent({ imageBase64, mimeType = "image/jpeg", text } = {}) {
  if (imageBase64 && typeof imageBase64 === "string" && imageBase64.trim().length > 0) {
    // Strip data URL prefix if caller passed "data:image/jpeg;base64,..."
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    const cleanMime = match ? match[1] : mimeType || "image/jpeg";
    const cleanBase64 = match ? match[2] : imageBase64.trim();

    const parsed = await callGeminiJSON({
      systemInstruction:
        "You are the IngestAgent for Samajh, an NISM financial certification study tool. " +
        "Examine the uploaded photo of study material and transcribe ONLY the substantive study content " +
        "(concepts, definitions, formulas, worked numerical examples, tables, SEBI/NSE/NISM rules). " +
        "Ignore page numbers, watermarks, headers/footers, and background clutter. " +
        "CRITICAL: If the photo is blurry, poorly lit, cut off, or does not contain readable study material, " +
        "set could_read to false and raw_text to an empty string. NEVER invent or guess unreadable text.",
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: cleanMime,
                data: cleanBase64,
              },
            },
            {
              text: "Transcribe the substantive study material from this photo. Set could_read to false if unreadable.",
            },
          ],
        },
      ],
      responseSchema: ingestResponseSchema,
    });

    if (!parsed.could_read || !parsed.raw_text || parsed.raw_text.trim().length < 15) {
      const err = new Error(
        parsed.reason?.trim() ||
          "Could not read the study page clearly. Try better lighting, hold steady, or paste the text directly."
      );
      err.statusCode = 422;
      throw err;
    }

    return {
      raw_text: parsed.raw_text.trim(),
    };
  }

  // Text-only path: skip Gemini call and return directly
  const cleanedText = typeof text === "string" ? text.trim() : "";
  if (cleanedText.length < 20) {
    const err = new Error(
      "Please paste at least a short paragraph of NISM study text (20+ characters) or upload a page photo."
    );
    err.statusCode = 400;
    throw err;
  }

  return {
    raw_text: cleanedText,
  };
}
