const express = require("express");
const auth = require("../../middlewares/check-auth");
const c = require("../../controllers/v1.controllers/project.controllers");

const router = express.Router();

router.post("/", auth, c.create);
router.get("/", auth, c.list);
router.get("/revenue", auth, c.revenue); // must precede /:id
router.get("/:id", auth, c.getOne);
router.put("/:id", auth, c.update);

module.exports = router;
