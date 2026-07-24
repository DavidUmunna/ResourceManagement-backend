const fs = require("fs");

jest.mock("fs", () => ({
  promises: {
    appendFile: jest.fn(),
  },
}));

const { handleCspReport } = require("../../controllers/cspReport.controller");

describe("cspReport.controller", () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns 204 and appends report payload to file", async () => {
    const req = {
      body: {
        "csp-report": {
          "blocked-uri": "inline",
          "violated-directive": "script-src",
        },
      },
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      json: jest.fn(),
    };

    fs.promises.appendFile.mockResolvedValue();

    await handleCspReport(req, res);

    expect(fs.promises.appendFile).toHaveBeenCalledTimes(1);
    expect(fs.promises.appendFile.mock.calls[0][0]).toEqual(expect.stringContaining("cspreports.txt"));
    expect(fs.promises.appendFile.mock.calls[0][1]).toEqual(expect.stringContaining('"csp-report"'));
    expect(fs.promises.appendFile.mock.calls[0][1]).toEqual(expect.stringContaining("\n\n"));
    expect(fs.promises.appendFile.mock.calls[0][2]).toBe("utf8");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when report serialization fails", async () => {
    const circular = {};
    circular.self = circular;

    const req = { body: circular };
    const res = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      json: jest.fn(),
    };

    await handleCspReport(req, res);

    expect(fs.promises.appendFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: "Failed to process CSP report" });
  });
});