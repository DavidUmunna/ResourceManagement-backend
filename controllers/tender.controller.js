const tenderService = require("../services/tender.service");
const { getPagination } = require("../Global_Functions/pagination");

module.exports = {
  async create(req, res) {
    try {
      const tender = await tenderService.create(req.body, req.user);
      res.status(201).json({ success: true, data: tender });
    } catch (err) {
      console.error("create tender error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async list(req, res) {
    try {
      const { page, limit, skip } = getPagination(req);
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.client) filter.client = req.query.client;
      const result = await tenderService.list(filter, { skip, limit });
      res.json({ success: true, data: result.data, pagination: { total: result.total, page, limit } });
    } catch (err) {
      console.error("list tenders error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async get(req, res) {
    try {
      const tender = await tenderService.get(req.params.id);
      if (!tender) return res.status(404).json({ success: false, message: "Tender not found" });
      res.json({ success: true, data: tender });
    } catch (err) {
      console.error("get tender error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async update(req, res) {
    try {
      const tender = await tenderService.update(req.params.id, req.body, req.user);
      if (!tender) return res.status(404).json({ success: false, message: "Tender not found" });
      res.json({ success: true, data: tender });
    } catch (err) {
      console.error("update tender error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
