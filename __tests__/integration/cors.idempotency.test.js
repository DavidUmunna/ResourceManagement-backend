// The production CORS config must let the browser send `Idempotency-Key` on
// PO create; otherwise the preflight blocks every create from the frontend.
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const corsOptions = require('../../config/cors');

function buildApp() {
  const app = express();
  app.use(cors(corsOptions));
  app.post('/api/orders', (_req, res) => res.status(201).json({ ok: true }));
  return app;
}

describe('CORS preflight for PO create', () => {
  it('allows the Idempotency-Key header from the production frontend origin', async () => {
    const res = await request(buildApp())
      .options('/api/orders')
      .set('Origin', 'https://erp.haldengroup.ng')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key,ngrok-skip-browser-warning');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://erp.haldengroup.ng');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const allowed = (res.headers['access-control-allow-headers'] || '').toLowerCase().split(/\s*,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(['idempotency-key', 'content-type']));
  });

  it('does not allow an unknown origin', async () => {
    const res = await request(buildApp())
      .options('/api/orders')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
