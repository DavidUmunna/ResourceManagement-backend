const express = require("express");
const auth = require("../../middlewares/check-auth");
const c = require("../../controllers/v1.controllers/truck.controllers");

const router = express.Router();

// Trucks — real, queryable entities
router.post("/", auth, c.create);
router.get("/", auth, c.list);
router.get("/:id", auth, c.getOne);
router.put("/:id", auth, c.update);
router.put("/:id/assign-driver", auth, c.assignDriver); // FR-1: reassignment always allowed

module.exports = router;
