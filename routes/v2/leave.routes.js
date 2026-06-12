const express = require('express');
const auth = require('../../middlewares/check-auth');
const leaveController = require('../../controllers/v2.controllers/leave.controllers');

const router = express.Router();

// ── Leave Requests ──────────────────────────────────────────────────────────
// Any authenticated user can create a request or view their own
router.post('/requests', auth, leaveController.createRequest);
router.get('/requests', auth, leaveController.getRequests);
router.get('/requests/export', auth, leaveController.exportRequests);
router.get('/requests/:id', auth, leaveController.getRequestById);

// Admin / global_admin only — approval and rejection
router.put('/requests/:id/approve', auth, leaveController.approveRequest);
router.put('/requests/:id/reject', auth, leaveController.rejectRequest);
router.put('/requests/:id/cancel', auth, leaveController.cancelRequest); // Employee can cancel (only while Pending)

// Owner or admin can cancel (only while Pending)
router.delete('/requests/:id', auth, leaveController.cancelRequest);

// ── Leave Policy (org-wide default entitlements) ────────────────────────────
// Any authenticated user can read the policy; only admins can change it
router.get('/policy', auth, leaveController.getPolicy);
router.put('/policy', auth, leaveController.updatePolicy);

// ── Leave Balances ───────────────────────────────────────────────────────────
// Any user can view their own balance; admin can view or update any user's
router.get('/balance', auth, leaveController.getBalance);
router.get('/balance/:userId', auth, leaveController.getBalance);
router.put('/balance/:userId', auth, leaveController.updateEntitlement);

module.exports = router;
