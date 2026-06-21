const { Storage } = require("@google-cloud/storage");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const storage = new Storage({
  keyFilename: path.join(__dirname, "./google-service-account-gcs.json"),
});

const BUCKET_NAME = "halden-backend-storage";
const bucket = storage.bucket(BUCKET_NAME);

const uploadFileToCloud = (filePath, filename, mimeType) => {
  return new Promise((resolve, reject) => {
    const objectName = `${uuidv4()}-${filename}`;
    const blob = bucket.file(objectName);

    const stream = require("fs").createReadStream(filePath);
    const writeStream = blob.createWriteStream({
      metadata: { contentType: mimeType },
    });

    stream
      .pipe(writeStream)
      .on("error", reject)
      .on("finish", () => {
        resolve({
          objectName,
          bucket: BUCKET_NAME,
        });
      });
  });
};

const uploadBufferToCloud = async (buffer, filename, mimeType) => {
  const objectName = `${uuidv4()}-${filename}`;
  const blob = bucket.file(objectName);

  await blob.save(buffer, {
    metadata: { contentType: mimeType },
  });

  return { objectName, bucket: BUCKET_NAME };
};

const downloadFileFromCloud = async (objectName, res, filename) => {
  try {
    const file = bucket.file(objectName);
    const [metadata] = await file.getMetadata();

    const mimeType = metadata.contentType || "application/octet-stream";
    const fileName = filename || metadata.name || "downloaded_file";
    const fileSize = metadata.size;

    if (fileSize) {
      res.setHeader("Content-Length", fileSize);
    }

    const inlineTypes = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
    ];
    const dispositionType = inlineTypes.includes(mimeType) ? "inline" : "attachment";

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `${dispositionType}; filename="${fileName}"`);

    file
      .createReadStream()
      .on("end", () => console.log("Download complete"))
      .on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).send("Error during file stream");
      })
      .pipe(res);
  } catch (err) {
    console.error("Download failed:", err.message);
    res.status(500).send("Failed to download file");
  }
};

module.exports = {
  uploadFileToCloud,
  uploadBufferToCloud,
  downloadFileFromCloud,
};
