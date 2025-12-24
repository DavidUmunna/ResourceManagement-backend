const TenderDraft = require("../models/TenderDraft");

module.exports = {
  create: (payload) => TenderDraft.create(payload),
  findByTender: (tenderId) => TenderDraft.find({ tenderId }).sort({ createdAt: -1 }),
  findByTenderAndSections: (tenderId, sections = []) =>
    TenderDraft.find({ tenderId, section: { $in: sections } }),
};
