const tenderUploadService = require("../services/tenderUpload.service");

module.exports = {
  async upload(req, res) {
    try {
      const { tenderId } = req.body;
      if (!req.file) {
        return res.status(400).json({ success: false, message: "file is required" });
      }
      if (!req.file.mimetype || !req.file.mimetype.includes("pdf")) {
        return res.status(400).json({ success: false, message: "PDF file required" });
      }

      const result = await tenderUploadService.uploadAndParse({
        tenderId,
        file: req.file,
        user: req.user,
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      const status = err.status || 500;
      console.error("tender upload error:", err);
      return res.status(status).json({ success: false, message: err.message || "Server error" });
    }
  },
  async listChecklist(req, res) {
    try {
      const { tenderId } = req.params;
      if (!tenderId) {
        return res.status(400).json({ success: false, message: "tenderId is required" });
      }
      const items = await tenderUploadService.listChecklist(tenderId);
      return res.json({ success: true, data: items });
    } catch (err) {
      console.error("tender checklist error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
