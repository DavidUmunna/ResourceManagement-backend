const Tender = require("../models/Tender");

module.exports = {
  create: (payload) => Tender.create(payload),
  findById: (id) => Tender.findById(id),
  updateById: (id, update) =>
    Tender.findByIdAndUpdate(id, update, { new: true }),
  find: (filter = {}, pagination = {}) => {
    const { skip = 0, limit = 20 } = pagination;
    return Tender.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  },
  count: (filter = {}) => Tender.countDocuments(filter),
};
