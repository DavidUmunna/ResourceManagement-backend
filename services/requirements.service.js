const reqRepo = require("../repositories/requirements.repository");
const docsRepo = require("../repositories/documents.repository");
const aiGateway = require("./ai/aiGateway.service");

function buildExtractionPrompt(corpus) {
  return `
You are an expert bid analyst. Extract distinct requirements from the tender text.
For each requirement, classify category (Technical | HSE | Compliance) and mark mandatory=true/false.
Return JSON array of { text, category, mandatory }.

Tender text:
${corpus}
`;
}

module.exports = {
  async extractRequirements(tenderId, user) {
    const docs = await docsRepo.findTenderDocs(tenderId);
    const corpus = docs.map((d) => d.textExtract || "").join("\n\n").slice(0, 15000);
    const prompt = buildExtractionPrompt(corpus);
    const aiResp = await aiGateway.extractRequirements(prompt);
    const requirements =
      Array.isArray(aiResp) ? aiResp : aiResp?.requirements || aiResp?.data || [];

    const prepared = requirements
      .filter((r) => r?.text)
      .map((r) => ({
        tenderId,
        text: r.text,
        category: r.category || "Technical",
        mandatory: typeof r.mandatory === "boolean" ? r.mandatory : true,
        extractedBy: user?.userId || "AI",
      }));

    if (!prepared.length) {
      // fallback: create a single generic requirement
      prepared.push({
        tenderId,
        text: "General requirement (fallback)",
        category: "Technical",
        mandatory: true,
        extractedBy: user?.userId || "AI",
      });
    }
    return reqRepo.bulkInsert(prepared);
  },

  listRequirements: (tenderId, filter) => reqRepo.findByTender(tenderId, filter),
};
