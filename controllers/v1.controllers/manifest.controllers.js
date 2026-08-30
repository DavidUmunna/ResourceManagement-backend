const PDFDocument = require("pdfkit");
const service = require("../../services/manifest.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`manifest.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

// ── Staff ─────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const data = await service.createManifest(req.user, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.list = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const data = await service.listManifests(filter);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getManifest(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getOne");
  }
};

exports.attachSkips = async (req, res) => {
  try {
    const data = await service.attachSkips(req.user, req.params.id, req.body.skipIds);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "attachSkips");
  }
};

// Shared PDF renderer (used by staff + approver-scoped exports).
function streamManifestPdf(res, m) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="manifest-${m.manifestNo}.pdf"`);
  doc.pipe(res);

    doc.fontSize(18).text("Waste Disposal Manifest", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(11);
    doc.text(`Manifest No:  ${m.manifestNo}`);
    doc.text(`Status:       ${m.status}`);
    doc.text(`Created:      ${m.createdAt ? new Date(m.createdAt).toLocaleString() : "—"}`);
    doc.text(`Created by:   ${m.createdBy?.name || "—"}`);
    doc.text(`Site approver:${m.siteApproverId?.name ? ` ${m.siteApproverId.name} (${m.siteApproverId.phone || ""})` : " —"}`);
    if (m.signedBy?.name) doc.text(`Signed by:    ${m.signedBy.name} on ${m.signedAt ? new Date(m.signedAt).toLocaleString() : ""}`);
    if (m.status === "rejected") {
      doc.moveDown(0.5).fillColor("red").text(`Rejected by ${m.rejectedBy?.name || "approver"}: ${m.rejectionReason || ""}`).fillColor("black");
    }

    doc.moveDown(1).fontSize(13).text(`Attached skips (${(m.attachedSkipIds || []).length})`, { underline: true });
    doc.moveDown(0.5).fontSize(10);
    if (!(m.attachedSkipIds || []).length) {
      doc.text("No skips attached.");
    } else {
      m.attachedSkipIds.forEach((s, i) => {
        const qty = s.Quantity?.value ? `${s.Quantity.value} ${s.Quantity.unit || ""}` : "—";
        doc.text(`${i + 1}. ${s.skip_id}   ·   ${s.WasteStream || "—"}   ·   qty ${qty}   ·   source ${s.WasteSource || "—"}`);
      });
    }

  doc.moveDown(2).fontSize(8).fillColor("gray")
    .text(`Generated ${new Date().toLocaleString()}`, { align: "right" });
  doc.end();
}

// Stream a PDF of the manifest (the "Download PDF" export) — staff.
exports.exportPdf = async (req, res) => {
  try {
    const m = await service.getManifest(req.params.id); // populated (throws 404 before streaming)
    return streamManifestPdf(res, m);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error("manifest.controller exportPdf:", e);
    return res.status(status).json({ success: false, message: e.message || "Failed to generate PDF" });
  }
};

// ── Approver-scoped reads (portal; require check-auth-site-approver) ───────────
exports.listMine = async (req, res) => {
  try {
    const data = await service.listForApprover(req.siteApprover.id, req.query.status);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "listMine");
  }
};

exports.getMine = async (req, res) => {
  try {
    const data = await service.getForApprover(req.siteApprover.id, req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getMine");
  }
};

exports.exportMinePdf = async (req, res) => {
  try {
    const m = await service.getForApprover(req.siteApprover.id, req.params.id);
    return streamManifestPdf(res, m);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error("manifest.controller exportMinePdf:", e);
    return res.status(status).json({ success: false, message: e.message || "Failed to generate PDF" });
  }
};

// ── Site approver (OTP-authenticated) ─────────────────────────────────────────
exports.sign = async (req, res) => {
  try {
    const data = await service.signManifest(req.siteApprover, req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "sign");
  }
};

exports.reject = async (req, res) => {
  try {
    const data = await service.rejectManifest(req.siteApprover, req.params.id, req.body.reason);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "reject");
  }
};
