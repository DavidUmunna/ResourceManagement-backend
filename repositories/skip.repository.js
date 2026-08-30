const Skip = require("../models/skips_tracking");

// Plain-function repository (mirrors driver/truck repositories).

// Populate both leg-trucks AND each truck's current driver, so the scan flow can
// credit the driver on duty at scan time (FR-6) without extra round-trips.
const withTrucks = (q) =>
  q
    .populate({ path: "assignedDeliveryTruckId", populate: { path: "currentDriverId" } })
    .populate({ path: "assignedCollectionTruckId", populate: { path: "currentDriverId" } })
    .populate("waybillId") // for the FR-17e mobilize gate (waybill must be approved)
    .populate("projectId", "name code client site");

exports.findById = (id) => withTrucks(Skip.findById(id));

// Raw doc (no populate) — used when we only need the skip's own fields.
exports.findByIdRaw = (id) => Skip.findById(id);

// Resolve a skip by its RFID tag. Only ACTIVE skips are scan targets (FR-9/FR-12).
exports.findActiveByTag = (rfidTag) => withTrucks(Skip.findOne({ rfidTag, active: { $ne: false } }));

// Any active skip currently bound to this tag other than `exceptId` (FR-8 guard).
exports.findTagConflict = (rfidTag, exceptId) =>
  Skip.findOne({ rfidTag, active: { $ne: false }, _id: { $ne: exceptId } });

exports.update = (id, data) =>
  Skip.findByIdAndUpdate(id, { ...data, lastUpdated: Date.now() }, { new: true, runValidators: true });

exports.findMany = (filter, { skip = 0, limit = 20 } = {}) =>
  Skip.find(filter).sort({ lastUpdated: -1, createdAt: -1 }).skip(skip).limit(limit)
    .populate("projectId", "name code");

exports.count = (filter) => Skip.countDocuments(filter);

// Deployed skips that belong to a project — the billable set for revenue.
exports.findDeployedWithProject = () =>
  Skip.find({ projectId: { $ne: null }, DateMobilized: { $ne: null } })
    .select("skip_id projectId DateMobilized DemobilizationOfFilledSkips dailyRateUsdOverride")
    .lean();

// Active rented skips whose rental ends on/before `beforeDate` (Phase 6 nag).
exports.findExpiringRentals = (beforeDate) =>
  Skip.find({
    ownership: "rented",
    active: { $ne: false },
    rentalExpectedEnd: { $ne: null, $lte: beforeDate },
  });
