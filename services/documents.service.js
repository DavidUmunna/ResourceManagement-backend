const path = require("path");
const fs = require("fs");
const fileStorage = require("../adapters/storage/fileStorage");
const docsRepo = require("../repositories/documents.repository");
const embeddingService = require("./ai/embedding.service");

let pdfTextExtractor;
function getPdfTextExtractor() {
  if (pdfTextExtractor) {
    return pdfTextExtractor;
  }
  try {
    pdfTextExtractor = require("pdf-parse");
  } catch (err) {
    console.warn("pdf-parse unavailable; skipping PDF text extraction.", err);
    pdfTextExtractor = null;
  }
  return pdfTextExtractor;
}

async function extractText(filePath, mimeType) {
  if (mimeType === "application/pdf") {
    const extractor = getPdfTextExtractor();
    if (!extractor) {
      return "";
    }
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await extractor(dataBuffer);
    return parsed?.text || "";
  }
  // Fallback: read raw text for non-PDF
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return "";
  }
}

module.exports = {
  async uploadTenderDoc(tenderId, file, user) {
    const storagePath = fileStorage.save(file);
    const textExtract = await extractText(storagePath, file.mimetype);
    const embeddingsRef = embeddingService.indexText(textExtract, { tenderId });
    return docsRepo.createTenderDoc({
      tenderId,
      filename: file.originalname,
      storagePath,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: user?.userId,
      textExtract,
      embeddingsRef,
    });
  },

  async uploadCompanyDoc(payload, file, user) {
    const storagePath = fileStorage.save(file);
    const textExtract = await extractText(storagePath, file.mimetype);
    const embeddingsRef = embeddingService.indexText(textExtract, {
      type: payload.type,
      validTo: payload.validTo,
    });
    return docsRepo.createCompanyDoc({
      ...payload,
      storagePath,
      mimeType: file.mimetype,
      textExtract,
      embeddingsRef,
      uploadedBy: user?.userId,
    });
  },

  listTenderDocs: (tenderId) => docsRepo.findTenderDocs(tenderId),
  listCompanyDocs: (filter) => docsRepo.findCompanyDocs(filter),
};
