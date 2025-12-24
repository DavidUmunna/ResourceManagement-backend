const draftRepo = require("../repositories/drafts.repository");
const reqRepo = require("../repositories/requirements.repository");
const docsRepo = require("../repositories/documents.repository");
const ragService = require("./ai/rag.service");
const aiGateway = require("./ai/aiGateway.service");
const docxExporter = require("../adapters/exporters/docxExporter");
const pdfExporter = require("../adapters/exporters/pdfExporter");

function buildDraftPrompt(section, requirements, contextDocs) {
  return `
You are a senior proposal writer for oil & gas services.
Draft the section: ${section}.
Use provided requirements and company evidence. Cite document references in-line (e.g., [Doc:${contextDocs
    .map((d) => d.id)
    .join(",")}]).
Return a concise, actionable draft. Avoid hallucinations; only use provided evidence.

Requirements:
${requirements.map((r) => `- ${r.text}`).join("\n")}

Evidence:
${contextDocs.map((d) => `- (${d.id}) ${d.text.slice(0, 200)}`).join("\n")}
`;
}

module.exports = {
  async generateDraft(tenderId, section) {
    const requirements = await reqRepo.findByTender(tenderId);
    const contextDocs = await ragService.retrieveContext(
      requirements.map((r) => r.text).join(" "),
      { topK: 5, filter: {} }
    );
    const prompt = buildDraftPrompt(section, requirements, contextDocs);
    const aiResp = await aiGateway.generate(prompt);
    const content =
      typeof aiResp === "string"
        ? aiResp
        : aiResp.content || aiResp.text || JSON.stringify(aiResp);

    const draft = await draftRepo.create({
      tenderId,
      section,
      content,
      references: contextDocs.map((d) => d.id),
    });
    return draft;
  },

  listDrafts: (tenderId) => draftRepo.findByTender(tenderId),

  async exportDrafts(tenderId, format = "docx") {
    const drafts = await draftRepo.findByTender(tenderId);
    if (format === "pdf") return pdfExporter.render(drafts);
    return docxExporter.render(drafts);
  },
};
