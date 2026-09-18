const express = require('express');
const router = express.Router();
const monitoringController = require('../../controllers/v1.controllers/Monitoring_control');

// ── Sentry tunnel ────────────────────────────────────────────────────────────
// The browser SDK POSTs event envelopes here (same-origin to our API) instead of
// straight to Sentry's ingest host, so ad-blockers / CSP / ingest-CORS can't drop
// them in production. We forward the raw envelope to the ONE known project only.
const SENTRY_HOST = 'o4509425534042112.ingest.de.sentry.io';
const SENTRY_PROJECT_ID = '4509425539416144';

router.post('/sentry-tunnel', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.sendStatus(400);

    // The envelope's first newline-delimited line is a JSON header carrying the DSN.
    const nl = body.indexOf(0x0a);
    if (nl === -1) return res.sendStatus(400);
    const header = JSON.parse(body.slice(0, nl).toString('utf8'));

    // SSRF guard: only ever forward to our own project, never an arbitrary DSN.
    const dsn = new URL(header.dsn);
    const projectId = dsn.pathname.replace(/\//g, '');
    if (dsn.hostname !== SENTRY_HOST || projectId !== SENTRY_PROJECT_ID) {
      return res.sendStatus(403);
    }

    const upstream = await fetch(`https://${SENTRY_HOST}/api/${SENTRY_PROJECT_ID}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
    });
    return res.sendStatus(upstream.ok ? 200 : 502);
  } catch (err) {
    console.error('sentry-tunnel forward failed:', err.message);
    return res.sendStatus(502);
  }
});

router.post('/', monitoringController.createMonitoringLog);
router.get('/', monitoringController.getMonitoringLogs);
router.get('/stats', monitoringController.getResponseTimeStats);
router.get('/:id', monitoringController.getMonitoringLogById);
router.delete('/cleanup', monitoringController.cleanupOldLogs);

module.exports = router;
