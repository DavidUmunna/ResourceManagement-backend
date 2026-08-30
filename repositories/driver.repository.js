const Driver = require("../models/Driver");

exports.create = (data) => Driver.create(data);
exports.findById = (id) => Driver.findById(id);
exports.findAll = (filter = {}) => Driver.find(filter).sort({ createdAt: -1 });
exports.update = (id, data) =>
  Driver.findByIdAndUpdate(id, data, { new: true, runValidators: true });
