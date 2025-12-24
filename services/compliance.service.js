const complianceRepo = require("../repositories/compliance.repository");
const reqRepo = require("../repositories/requirements.repository");
const docsRepo = require("../repositories/documents.repository");
const ragService = require("./ai/rag.service");

module.exports = {
  async runComplianceCheck(tenderId) {
    const requirements = await reqRepo.findByTender(tenderId);
    const companyDocs = await docsRepo.findCompanyDocs({});

    // index company docs into vector store via embeddingsRef already created
    const issues = [];
    for (const req of requirements) {
      const hits = ragService.retrieveContext(req.text, { topK: 3, filter: { valid: true } });
      const hasEvidence = hits.some((h) => h.score >= 0.25);
      if (req.mandatory && !hasEvidence) {
        issues.push({
          tenderId,
          requirementId: req._id,
          description: "No matching evidence found for mandatory requirement",
          evidenceDocs: [],
        });
      }
    }
    if (!issues.length) return [];
    return complianceRepo.bulkInsert(issues);
  },

  listIssues: (tenderId) => complianceRepo.findByTender(tenderId),
};
