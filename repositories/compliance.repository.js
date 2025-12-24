const ComplianceIssue = require("../models/ComplianceIssue");

module.exports = {
  bulkInsert: (items) => ComplianceIssue.insertMany(items),
  findByTender: (tenderId) => ComplianceIssue.find({ tenderId }).sort({ createdAt: -1 }),
};
