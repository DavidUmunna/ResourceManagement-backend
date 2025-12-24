const draftsService = require("../services/drafts.service");

module.exports = {
  async generate(req, res) {
    try {
      const draft = await draftsService.generateDraft(req.params.tenderId, req.params.section);
      res.status(201).json({ success: true, data: draft });
    } catch (err) {
      console.error("generate draft error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async list(req, res) {
    try {
      const drafts = await draftsService.listDrafts(req.params.tenderId);
      res.json({ success: true, data: drafts });
    } catch (err) {
      console.error("list drafts error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async export(req, res) {
    try {
      const format = req.query.format || "docx";
      const buffer = await draftsService.exportDrafts(req.params.tenderId, format);
      res.setHeader(
        "Content-Type",
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename=tender-${req.params.tenderId}.${format}`);
      res.send(buffer);
    } catch (err) {
      console.error("export drafts error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
