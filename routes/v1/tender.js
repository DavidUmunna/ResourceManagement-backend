const express = require("express");
const auth = require("../../middlewares/check-auth");
const multer = require("multer");
const upload = multer({ dest: "tempUploads/" });
const tenderController = require("../../controllers/tender.controller");
const documentsController = require("../../controllers/documents.controller");
const requirementsController = require("../../controllers/requirements.controller");
const draftsController = require("../../controllers/drafts.controller");
const complianceController = require("../../controllers/compliance.controller");
const tenderUploadController = require("../../controllers/tenderUpload.controller");

const router = express.Router();

// Tender core
router.post("/", auth, tenderController.create);
router.get("/", auth, tenderController.list);
router.get("/:id", auth, tenderController.get);
router.patch("/:id", auth, tenderController.update);
router.post("/upload", auth, upload.single("file"), tenderUploadController.upload);
router.get("/:tenderId/checklist", auth, tenderUploadController.listChecklist);

// Tender documents
router.post("/:tenderId/documents", auth, upload.single("file"), documentsController.uploadTenderDoc);
router.get("/:tenderId/documents", auth, documentsController.listTenderDocs);

// Company knowledge base documents
router.post("/company-docs", auth, upload.single("file"), documentsController.uploadCompanyDoc);
router.get("/company-docs/list", auth, documentsController.listCompanyDocs);

// Requirement extraction
router.post("/:tenderId/requirements/extract", auth, requirementsController.extract);
router.get("/:tenderId/requirements", auth, requirementsController.list);

// Drafts
router.post("/:tenderId/drafts/:section", auth, draftsController.generate);
router.get("/:tenderId/drafts", auth, draftsController.list);
router.get("/:tenderId/export", auth, draftsController.export);

// Compliance
router.post("/:tenderId/compliance/check", auth, complianceController.check);
router.get("/:tenderId/compliance", auth, complianceController.list);

module.exports = router;
