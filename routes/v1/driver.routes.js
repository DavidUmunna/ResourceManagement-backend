const express = require("express");
const auth = require("../../middlewares/check-auth");
const c = require("../../controllers/v1.controllers/driver.controllers");

const router = express.Router();

// Drivers — real, queryable entities (replace free-text driver names on skips)
router.post("/", auth, c.create);
router.get("/", auth, c.list);
router.get("/:id", auth, c.getOne);
router.put("/:id", auth, c.update);

module.exports = router;
