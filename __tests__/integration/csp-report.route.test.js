const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const fs = require("fs");

jest.mock("fs", () => ({
  promises: {
    appendFile: jest.fn(),
  },
}));

const { handleCspReport } = require("../../controllers/cspReport.controller");

function createTestApp() {
  const app = express();

  app.use(express.json({
    type: ["application/json", "application/csp-report", "application/reports+json"],
  }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const csrfExcludedPaths = ["/csp-report", "/csp-report/"];
    const isUnsafeMethod = ["POST", "PUT", "DELETE"].includes(req.method);
    const isExcludedPath = csrfExcludedPaths.includes(req.path);

    if (isUnsafeMethod && !isExcludedPath) {
      return res.status(403).json({ error: "Forbidden - CSRF validation failed" });
    }

    return next();
  });

  app.post("/csp-report", handleCspReport);
  app.post("/unsafe-test", (req, res) => res.status(200).json({ ok: true }));

  return app;
}

describe("/csp-report route integration", () => {
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("accepts CSP reports without CSRF token and persists payload", async () => {
    const app = createTestApp();
    fs.promises.appendFile.mockResolvedValue();

    const response = await request(app)
      .post("/csp-report")
      .set("Content-Type", "application/csp-report")
      .send(JSON.stringify({
        "csp-report": {
          "blocked-uri": "inline",
          "violated-directive": "script-src",
        },
      }));

    expect(response.status).toBe(204);
    expect(fs.promises.appendFile).toHaveBeenCalledTimes(1);
    expect(fs.promises.appendFile.mock.calls[0][0]).toEqual(expect.stringContaining("cspreports.txt"));
    expect(fs.promises.appendFile.mock.calls[0][1]).toEqual(expect.stringContaining('"csp-report"'));
  });

  it("still enforces CSRF on non-excluded unsafe routes", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/unsafe-test")
      .send({ ok: true });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Forbidden - CSRF validation failed" });
  });
});