const { google } = require("googleapis");
const fs = require("fs");
const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "./google-service-account.json"),
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });

const uploadFileToDrive = async (filePath, filename, mimeType) => {
  const fileMetadata = {
    name: filename,
    parents: ['14KS2uo3V7kKqKx0xMY05xzUIOFJGHHLu'], 
  };
  const media = {
    mimeType,
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id, webViewLink, webContentLink",
  });

  return response.data;
};

const downloadFileFromDrive = async (fileId, res) => {
  try {
    // Get the file content as a stream
    const driveRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    // Get the file metadata (name and MIME type)
    const meta = await drive.files.get({ fileId, fields: "name, mimeType, size" });

    const mimeType = meta.data.mimeType || "application/octet-stream";
    const fileName = meta.data.name || "downloaded_file";
     
    const fileSize = meta.data.size;
    if (fileSize) {
      res.setHeader("Content-Length", fileSize);
    }
    // List of types to be displayed inline instead of downloaded
    const inlineTypes = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf"
    ];

    const dispositionType = inlineTypes.includes(mimeType) ? "inline" : "attachment";

    // Set response headers
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `${dispositionType}; filename="${fileName}"`);

    // Pipe the file stream to the client
    driveRes.data
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


const deleteFileFromDrive = async (fileId) => {
  await drive.files.delete({ fileId });
};

module.exports = {
  uploadFileToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
};
