const Project = require("../models/Project");

exports.create = (data) => Project.create(data);
exports.findById = (id) => Project.findById(id);
exports.findByCode = (code) => Project.findOne({ code });
exports.findAll = (filter = {}) => Project.find(filter).sort({ createdAt: -1 });
exports.update = (id, data) => Project.findByIdAndUpdate(id, data, { new: true, runValidators: true });
