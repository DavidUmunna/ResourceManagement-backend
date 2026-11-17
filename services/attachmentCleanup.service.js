/**
 * Attachment (File document + GCS/Drive objects) cleanup.
 *
 * - cascadeDeleteFile: used when an order is deleted.
 * - discardUnusedAttachment: used when a PO create is rejected or fails after
 *   the client already uploaded its attachment (the upload is a separate
 *   request, POST /api/fileupload/create). Only deletes a File the requester
 *   owns that no order references, so a client-supplied id can never remove
 *   someone else's attachment.
 */
const mongoose = require("mongoose");
const File = require("../models/file");
const PurchaseOrder = require("../models/PurchaseOrder");
const { deleteFileFromCloud } = require("../googlecloudstorage.service");
const { deleteFileFromDrive } = require("../googledriveservice");

async function deleteStoredObjects(fileDoc) {
  await Promise.allSettled(
    (fileDoc.files || []).map(async (f) => {
      try {
        if (f.gcsObjectName) {
          await deleteFileFromCloud(f.gcsObjectName);
        } else if (f.driveFileId) {
          await deleteFileFromDrive(f.driveFileId);
        }
      } catch (err) {
        console.error("Failed to delete attachment from storage:", err.message);
      }
    })
  );
}

/** Delete a File document and its stored objects. Returns true if it existed. */
async function cascadeDeleteFile(fileId) {
  if (!fileId) return false;
  const fileDoc = await File.findById(fileId);
  if (!fileDoc) return false;
  await deleteStoredObjects(fileDoc);
  await File.findByIdAndDelete(fileId);
  return true;
}

/**
 * Best-effort: delete an uploaded attachment that will not be used by any order.
 * Never throws — a cleanup failure must not change the API response.
 */
async function discardUnusedAttachment(fileId, staffId) {
  try {
    if (!fileId || !staffId || !mongoose.isValidObjectId(fileId)) return false;
    const fileDoc = await File.findById(fileId);
    if (!fileDoc || !fileDoc.staff || String(fileDoc.staff) !== String(staffId)) return false;
    const referenced = await PurchaseOrder.exists({ fileRefs: fileId });
    if (referenced) return false;
    await deleteStoredObjects(fileDoc);
    await File.findByIdAndDelete(fileId);
    return true;
  } catch (err) {
    console.error("Failed to discard unused attachment:", err.message);
    return false;
  }
}

module.exports = { cascadeDeleteFile, discardUnusedAttachment };
