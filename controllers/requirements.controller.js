const requirementsService = require("../services/requirements.service");

module.exports = {
  async extract(req, res) {
    try {
      const reqs = await requirementsService.extractRequirements(req.params.tenderId, req.user);
      res.status(201).json({ success: true, data: reqs });
    } catch (err) {
      console.error("extract requirements error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async list(req, res) {
    try {
      const filter = {};
      if (req.query.category) filter.category = req.query.category;
      if (req.query.mandatory) filter.mandatory = req.query.mandatory === "true";
      const reqs = await requirementsService.listRequirements(req.params.tenderId, filter);
      res.json({ success: true, data: reqs });
    } catch (err) {
      console.error("list requirements error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
