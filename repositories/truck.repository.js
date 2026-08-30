const Truck = require("../models/Truck");

exports.create = (data) => Truck.create(data);
exports.findById = (id) => Truck.findById(id).populate("currentDriverId");
exports.findAll = (filter = {}) =>
  Truck.find(filter).populate("currentDriverId").sort({ createdAt: -1 });
exports.update = (id, data) =>
  Truck.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate("currentDriverId");
