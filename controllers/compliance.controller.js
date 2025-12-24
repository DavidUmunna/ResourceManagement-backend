const complianceService = require("../services/compliance.service");

module.exports = {
  async check(req, res) {
    try {
      const issues = await complianceService.runComplianceCheck(req.params.tenderId);
      res.status(201).json({ success: true, data: issues });
    } catch (err) {
      console.error("compliance check error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async list(req, res) {
    try {
      const issues = await complianceService.listIssues(req.params.tenderId);
      res.json({ success: true, data: issues });
    } catch (err) {
      console.error("list compliance error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
