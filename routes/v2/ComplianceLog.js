const express = require("express");
const auth = require("../../middlewares/check-auth");
const router = express.Router();
const complianceLogController = require("../../controllers/v2.controllers/ComplianceLog.controllers");

/**
 * @swagger
 * tags:
 *   name: ComplianceLogs
 *   description: Compliance logging endpoints (read-only; entries are generated automatically)
 */

/**
 * @swagger
 * /api/v2/compliance-logs:
 *   get:
 *     summary: List compliance logs
 *     tags: [ComplianceLogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (defaults to 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Page size (defaults to 20)
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action (CREATE|UPDATE|DELETE)
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Filter by entity id
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *         description: Filter by entity type
 *       - in: query
 *         name: performedBy
 *         schema:
 *           type: string
 *         description: Filter by actor id
 *     responses:
 *       200:
 *         description: List of compliance logs
 *       500:
 *         description: Server error
 */
router.get("/logs", auth, complianceLogController.getComplianceLogs);

/**
 * @swagger
 * /api/v2/compliance-logs/{id}:
 *   get:
 *     summary: Get a compliance log by ID
 *     tags: [ComplianceLogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Compliance log ID
 *     responses:
 *       200:
 *         description: Compliance log entry
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.get("/:id", auth, complianceLogController.getComplianceLogById);

module.exports = router;
