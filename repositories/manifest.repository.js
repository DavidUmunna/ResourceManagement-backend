const Manifest = require("../models/Manifest");

exports.create = (data) => Manifest.create(data);

exports.findById = (id) => Manifest.findById(id);

// Populated read for the detail view + PDF (mutation flows keep raw ids via findById).
exports.findByIdPopulated = (id) =>
  Manifest.findById(id)
    .populate({ path: "attachedSkipIds", select: "skip_id WasteStream Quantity DateFilled WasteSource" })
    .populate({ path: "previouslyAttachedSkipIds", select: "skip_id" })
    .populate({ path: "siteApproverId", select: "name phone site" });

exports.findAll = (filter = {}) => Manifest.find(filter).sort({ createdAt: -1 });

exports.update = (id, data) =>
  Manifest.findByIdAndUpdate(id, data, { new: true, runValidators: true });
