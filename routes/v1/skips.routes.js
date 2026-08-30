const express = require("express");
const auth = require("../../middlewares/check-auth");
const c = require("../../controllers/v1.controllers/skip.controllers");

const router = express.Router();

// Relational RFID skip operations (spec §6). The legacy flat CRUD stays at
// /api/skiptrack; these extend the same skip records with tag + leg lifecycle.

// Static routes first so they can't be shadowed by /:id.
router.post("/scan", auth, c.scan);            // FR-9 : RFID gate scan
router.post("/manual-scan", auth, c.manualScan); // FR-10: supervisor fallback

// Read endpoints for the ERP module.
router.get("/", auth, c.list);
router.get("/:id", auth, c.getOne);

router.post("/:id/register-tag", auth, c.registerTag);              // FR-7/8
router.put("/:id/assign-delivery-truck", auth, c.assignDeliveryTruck);   // FR-2/5
router.put("/:id/assign-collection-truck", auth, c.assignCollectionTruck); // FR-2/5
router.put("/:id/project", auth, c.setProject);                    // assign skip to a project
router.put("/:id/rate", auth, c.setRate);                          // per-skip daily rate override
router.put("/:id/rental", auth, c.setRental);                      // Phase 6: rental info
router.put("/:id/return", auth, c.returnSkip);                      // FR-16

module.exports = router;
