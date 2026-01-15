const TenderChecklistItem = require("../models/TenderChecklistItem");

module.exports = {
  bulkInsert: (items) => TenderChecklistItem.insertMany(items),
  findByTender: (tenderId) =>
    TenderChecklistItem.find({ tenderId }).sort({ createdAt: -1 }),
};
