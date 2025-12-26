
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

require("dotenv").config({ path: "../.env" });

const getDbFromUri = (uri) => {
  const match = uri && uri.match(/\/([^/?]+)(\?|$)/);
  return match ? match[1] : null;
};

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} failed with exit code ${result.status}`);
  }
};

const atlasUri = process.env.MONGO_ATLAS_URI;
const localUri = process.env.MONGO_URI;
const atlasDb = process.env.MONGO_ATLAS_DB;
const localDb = process.env.MONGO_LOCAL_DB || getDbFromUri(localUri);
const shouldDrop = process.env.MONGO_RESTORE_DROP === "true";

if (!atlasUri || !localUri) {
  throw new Error("Missing MONGO_ATLAS_URI or MONGO_URI in .env");
}

if (!atlasDb || !localDb) {
  throw new Error("Missing MONGO_ATLAS_DB or local DB name (MONGO_LOCAL_DB or MONGO_URI db)");
}

const dumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-dump-"));

try {
  console.log(`Dumping Atlas database "${atlasDb}"...`);
  run("mongodump", ["--uri", atlasUri, "--db", atlasDb, "--out", dumpDir]);

  console.log(`Restoring into local database "${localDb}"...`);
  const restoreArgs = [
    "--uri",
    localUri,
    "--dir",
    path.join(dumpDir, atlasDb),
    "--nsInclude",
    `${atlasDb}.*`,
    "--nsFrom",
    `${atlasDb}.*`,
    "--nsTo",
    `${localDb}.*`,
  ];
  if (shouldDrop) restoreArgs.push("--drop");
  run("mongorestore", restoreArgs);

  console.log("Restore completed successfully.");
} catch (error) {
  console.error("Restore failed:", error);
  process.exitCode = 1;
} finally {
  try {
    fs.rmSync(dumpDir, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn("Failed to remove temp dump folder:", cleanupError);
  }
}
