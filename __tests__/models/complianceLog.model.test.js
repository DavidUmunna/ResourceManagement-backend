const mongoose = require("mongoose");
const ComplianceLog = require("../../models/ComplianceLog");

// Mock-free schema validation. This is the test that would have caught the
// production bug where SCAN/APPROVE/SIGN/etc. failed the `action` enum and were
// silently dropped (logComplianceAction swallows errors by design).

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "SCAN", "MANUAL_SCAN", "APPROVE", "REJECT", "SIGN", "RETURN", "LOGIN"];

function base(overrides = {}) {
  return new ComplianceLog({
    action: "CREATE",
    entityType: "Skip",
    entityModel: "skip",
    entityId: new mongoose.Types.ObjectId(),
    performedBy: new mongoose.Types.ObjectId(),
    performedByModel: "user",
    ...overrides,
  });
}

describe("ComplianceLog model validation", () => {
  it.each(ACTIONS)("accepts action %s", (action) => {
    const err = base({ action }).validateSync();
    expect(err?.errors?.action).toBeUndefined();
  });

  it("rejects an unknown action", () => {
    const err = base({ action: "TELEPORT" }).validateSync();
    expect(err?.errors?.action).toBeDefined();
  });

  it.each(["FileTrack", "Skip", "Truck", "Driver", "Manifest", "Waybill", "SiteApprover"])(
    "accepts entityType %s", (entityType) => {
      const err = base({ entityType }).validateSync();
      expect(err?.errors?.entityType).toBeUndefined();
    }
  );

  it.each(["user", "siteapprover"])("accepts performedByModel %s", (m) => {
    const err = base({ performedByModel: m }).validateSync();
    expect(err?.errors?.performedByModel).toBeUndefined();
  });
});
