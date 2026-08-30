const SiteApprover = require("../models/SiteApprover");

exports.create = (data) => SiteApprover.create(data);

exports.findById = (id) => SiteApprover.findById(id);

exports.findByPhone = (phone) => SiteApprover.findOne({ phone });

// Never leak secrets in list views.
exports.findAll = (filter = {}) =>
  SiteApprover.find(filter).select("-passwordHash -otpHash").sort({ createdAt: -1 });

exports.update = (id, data) =>
  SiteApprover.findByIdAndUpdate(id, data, { new: true, runValidators: true });
