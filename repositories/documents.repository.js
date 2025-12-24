const TenderDocument = require("../models/TenderDocument");
const CompanyDocument = require("../models/CompanyDocument");

module.exports = {
  createTenderDoc: (payload) => TenderDocument.create(payload),
  findTenderDocs: (tenderId) => TenderDocument.find({ tenderId }).sort({ createdAt: -1 }),
  createCompanyDoc: (payload) => CompanyDocument.create(payload),
  findCompanyDocs: (filter = {}) => CompanyDocument.find(filter).sort({ createdAt: -1 }),
};
