const express = require("express");
const {
  predictiveMaintenance,
  interpretLabResults,
  optimizeLogistics,
  generateComplianceReport,
} = require("./ai.controller");

const router = express.Router();

router.post("/predict-maintenance", predictiveMaintenance);
router.post("/interpret-lab", interpretLabResults);
router.post("/optimize-logistics", optimizeLogistics);
router.post("/generate-report", generateComplianceReport);

module.exports = router;
