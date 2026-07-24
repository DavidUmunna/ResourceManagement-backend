const fs = require("fs");
const path = require("path");

async function handleCspReport(req, res) {
  try {
    const report = JSON.stringify(req.body || {}, null, 2);
    const logfile = path.join(__dirname, "..", "cspreports.txt");

    await fs.promises.appendFile(logfile, `${report}\n\n`, "utf8");

    return res.status(204).end();
  } catch (error) {
    console.error("csp error", error);
    return res.status(500).json({ message: "Failed to process CSP report" });
  }
}

module.exports = { handleCspReport };