const tenderRepo = require("../repositories/tender.repository");
const requirementsRepo = require("../repositories/requirements.repository");
const checklistRepo = require("../repositories/checklist.repository");
const documentsService = require("./documents.service");
const aiGateway = require("./ai/aiGateway.service");
const tenderService = require("./tender.service");
const fs = require("fs");

let pdfTextExtractor;
function getPdfTextExtractor() {
  if (pdfTextExtractor) return pdfTextExtractor;
  try {
    const mod = require("pdf-parse");
    pdfTextExtractor = typeof mod === "function" ? mod : mod?.default;
  } catch (err) {
    console.warn("pdf-parse unavailable; skipping PDF text extraction.", err);
    pdfTextExtractor = null;
  }
  return pdfTextExtractor;
}

const CATEGORY_SET = new Set(["Technical", "HSE", "Compliance"]);
const STATUS_SET = new Set(["Not Started", "In Progress", "Complete"]);

const fallbackChecklist = [
  { title: "Company registration documents (CAC)", category: "Compliance" },
  { title: "Tax clearance certificate", category: "Compliance" },
  { title: "NUPRC/DPR permits and regulatory approvals", category: "Compliance" },
  { title: "HSE policy and certifications", category: "HSE" },
  { title: "Insurance certificates", category: "Compliance" },
  { title: "Financial statements and bank reference", category: "Compliance" },
  { title: "Technical capability and relevant experience", category: "Technical" },
  { title: "Equipment and asset list", category: "Technical" },
  { title: "Key personnel CVs and certifications", category: "Technical" },
  { title: "Quality assurance and control plan", category: "Technical" },
  { title: "Local content plan", category: "Compliance" },
];

const buildPrompt = (corpus) => `
You are an oil and gas tender analyst. Extract the tender title, client, deadline, requirements, and checklist progress.
Return strict JSON with keys:
- title: short tender title
- client: client/company name
- deadline: ISO date string (YYYY-MM-DD) or null
- requirements: array of { text, category: Technical|HSE|Compliance, mandatory: true|false }
- checklist: array of { title, category, status: Not Started|In Progress|Complete, progress: 0-100 }

Tender text:
${corpus}
`;

const parseDeadline = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeRequirements = (items, tenderId, docId, user) =>
  items
    .filter((r) => r?.text)
    .map((r) => ({
      tenderId,
      sourceDocumentId: docId,
      text: r.text,
      category: CATEGORY_SET.has(r.category) ? r.category : "Technical",
      mandatory: typeof r.mandatory === "boolean" ? r.mandatory : true,
      extractedBy: user?.userId || "AI",
    }));

const normalizeChecklist = (items, tenderId, docId, user) =>
  items
    .filter((c) => c?.title)
    .map((c) => {
      const rawProgress =
        typeof c.progress === "string" ? c.progress.replace("%", "") : c.progress;
      const parsedProgress = Number(rawProgress);
      return {
        tenderId,
        sourceDocumentId: docId,
        title: c.title,
        category: c.category || "General",
        status: STATUS_SET.has(c.status) ? c.status : "Not Started",
        progress:
          Number.isFinite(parsedProgress) && parsedProgress >= 0 && parsedProgress <= 100
            ? parsedProgress
            : 0,
        extractedBy: user?.userId || "AI",
      };
    });

module.exports = {
  async uploadAndParse({ tenderId, file, user }) {
    const extractor = getPdfTextExtractor();
    const buffer = fs.readFileSync(file.path);
    const parsed = extractor ? await extractor(buffer) : { text: "" };
    const corpus = (parsed?.text || "").slice(0, 15000);
    const prompt = buildPrompt(corpus);

    const aiResponse = await aiGateway.generate(prompt);
    const deadline = parseDeadline(aiResponse?.deadline);
    const title = typeof aiResponse?.title === "string" ? aiResponse.title.trim() : "";
    const client = typeof aiResponse?.client === "string" ? aiResponse.client.trim() : "";

    let tender = null;
    if (!tenderId) {
      if (!title || !client || !deadline) {
        const err = new Error("Unable to extract tender title, client, or deadline");
        err.status = 422;
        throw err;
      }
      tender = await tenderService.create({ title, client, deadline }, user);
      tenderId = tender._id;
    } else {
      tender = await tenderRepo.findById(tenderId);
      if (!tender) {
        const err = new Error("Tender not found");
        err.status = 404;
        throw err;
      }
    }

    const document = await documentsService.uploadTenderDoc(tenderId, file, user);

    const requirements = normalizeRequirements(
      Array.isArray(aiResponse?.requirements) ? aiResponse.requirements : [],
      tenderId,
      document._id,
      user
    );

    const checklistSource = Array.isArray(aiResponse?.checklist)
      ? aiResponse.checklist
      : fallbackChecklist;

    const checklist = normalizeChecklist(checklistSource, tenderId, document._id, user);

    if (deadline && tenderId) {
      await tenderRepo.updateById(tenderId, { deadline, updatedAt: new Date() });
    }

    const [savedRequirements, savedChecklist] = await Promise.all([
      requirements.length ? requirementsRepo.bulkInsert(requirements) : [],
      checklist.length ? checklistRepo.bulkInsert(checklist) : [],
    ]);

    return {
      tender: tender || (await tenderRepo.findById(tenderId)),
      document,
      parsed: {
        title,
        client,
        deadline,
        requirements: savedRequirements,
        checklist: savedChecklist,
      },
    };
  },
  listChecklist: (tenderId) => checklistRepo.findByTender(tenderId),
};
