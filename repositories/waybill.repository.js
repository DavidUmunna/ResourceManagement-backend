const Waybill = require("../models/Waybill");

exports.create = (data) => Waybill.create(data);

exports.findById = (id) => Waybill.findById(id);

// Populated read for the detail view (kept separate so mutation flows keep raw ids).
exports.findByIdPopulated = (id) =>
  Waybill.findById(id).populate({ path: "attachedSkipIds", select: "skip_id WasteStream Quantity DateFilled" });

exports.findAll = (filter = {}) => Waybill.find(filter).sort({ createdAt: -1 });

exports.update = (id, data) =>
  Waybill.findByIdAndUpdate(id, data, { new: true, runValidators: true });
