const { runGemini } = require("../../ai/geminiClient");

const safeJson = (txt) => {
  if (!txt) return {};
  try {
    return typeof txt === "object" ? txt : JSON.parse(txt);
  } catch {
    return { text: txt };
  }
};

module.exports = {
  async extractRequirements(prompt) {
    const resp = await runGemini(prompt, "");
    return safeJson(resp);
  },
  async generate(prompt) {
    const resp = await runGemini(prompt, "");
    return safeJson(resp);
  },
};
