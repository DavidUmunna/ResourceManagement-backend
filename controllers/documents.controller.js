const documentsService = require("../services/documents.service");

module.exports = {
  async uploadTenderDoc(req, res) {
    try {
      const doc = await documentsService.uploadTenderDoc(req.params.tenderId, req.file, req.user);
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      console.error("upload tender doc error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async listTenderDocs(req, res) {
    try {
      const docs = await documentsService.listTenderDocs(req.params.tenderId);
      res.json({ success: true, data: docs });
    } catch (err) {
      console.error("list tender docs error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async uploadCompanyDoc(req, res) {
    try {
      const doc = await documentsService.uploadCompanyDoc(req.body, req.file, req.user);
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      console.error("upload company doc error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
  async listCompanyDocs(req, res) {
    try {
      const filter = {};
      if (req.query.type) filter.type = req.query.type;
      const docs = await documentsService.listCompanyDocs(filter);
      res.json({ success: true, data: docs });
    } catch (err) {
      console.error("list company docs error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};
