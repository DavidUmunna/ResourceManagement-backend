// Named role/enum constants for the Skips RFID Tracking feature.
// (Spec §4: role checks must be named constants, never inlined in routes.)
//
// The spec refers to "supervisor / admin / global_admin" and a notify list of
// "site_manager / waste_management_manager / supervisor / global_admin". Those
// are mapped here to the actual role strings in models/users_.js. Adjust these
// lists as roles evolve — nothing downstream should hardcode role strings.

// Roles allowed to perform a manual (fallback) scan (FR-10) and to approve
// waybills internally (FR-17d).
const MANUAL_SCAN_ROLES = ["admin", "global_admin", "Waste Management Supervisor"];
const WAYBILL_APPROVER_ROLES = MANUAL_SCAN_ROLES;

// Roles that receive consolidated issue notifications (FR-28).
const ISSUE_NOTIFY_ROLES = [
  "global_admin",
  "Waste Management Manager",
  "Waste Management Supervisor",
  "Facility Manager", // stands in for "site_manager"
];

// Enums shared across models/services
const SCAN_TYPES = ["mobilize", "demobilize"];
const SCAN_METHODS = ["rfid", "manual"];
const TRUCK_TYPES = ["delivery", "waste"];
const SKIP_OWNERSHIP = ["owned", "rented"];
const WAYBILL_STATUSES = ["draft", "issued", "approved", "rejected", "completed"];
const MANIFEST_STATUSES = ["draft", "issued", "signed", "completed", "rejected"];

// Issue event types for notifyIssue (FR-29)
const ISSUE_EVENTS = {
  MANUAL_SCAN: "Manual scan used",
  MANIFEST_REJECTED: "Manifest rejected",
  WAYBILL_REJECTED: "Waybill rejected",
  TAG_CONFLICT: "Tag registration conflict",
  RENTAL_EXPIRING: "Rental nearing expiry",
};

module.exports = {
  MANUAL_SCAN_ROLES,
  WAYBILL_APPROVER_ROLES,
  ISSUE_NOTIFY_ROLES,
  SCAN_TYPES,
  SCAN_METHODS,
  TRUCK_TYPES,
  SKIP_OWNERSHIP,
  WAYBILL_STATUSES,
  MANIFEST_STATUSES,
  ISSUE_EVENTS,
};
