const { GoogleGenerativeAI } = require("@google/generative-ai");

// Parse AI output defensively (strip fences, try slicing to JSON body)
const parseJsonSafe = (text) => {
  if (!text) {
    return { error: true, message: "Empty response from AI" };
  }

  let payload = text.trim();

  // If wrapped in ```json ... ```
  const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    payload = fenced[1].trim();
  }

  const tryParse = (value) => {
    try {
      return { data: JSON.parse(value) };
    } catch {
      return null;
    }
  };

  // First attempt
  let parsed = tryParse(payload);
  if (parsed) return parsed;

  // Try extracting the first/last JSON object in the text
  const start = payload.indexOf("{");
  const end = payload.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    parsed = tryParse(payload.slice(start, end + 1));
    if (parsed) return parsed;
  }

  return { error: true, message: "Invalid JSON response from AI" };
};

/**
 * Run a Gemini prompt using the gemini-2.5-flash model.
 * Safely parses JSON responses and returns an error object on malformed JSON.
 *
 * @param {string} systemPrompt - System-level instructions.
 * @param {string} userPrompt - User input / payload.
 * @returns {Promise<object>} Parsed JSON or an error object.
 */
async function runGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: true, message: "GEMINI_API_KEY is not set" };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `${(systemPrompt || "").trim()}\n\nUser:\n${userPrompt || ""}`;
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "";

    const parsed = parseJsonSafe(text);
    return parsed?.data ? parsed.data : parsed;
  } catch (err) {
    const message = err?.message || "Gemini request failed";
    return { error: true, message };
  }
}

module.exports = { runGemini };
