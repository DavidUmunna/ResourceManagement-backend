const TenderRequirement = require("../models/TenderRequirement");

module.exports = {
  bulkInsert: (items) => TenderRequirement.insertMany(items),
  findByTender: (tenderId, filter = {}) =>
    TenderRequirement.find({ tenderId, ...filter }).sort({ createdAt: -1 }),
};
