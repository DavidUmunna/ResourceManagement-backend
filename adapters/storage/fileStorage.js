const fs = require("fs");
const path = require("path");
const uploadDir = path.join(__dirname, "../../uploads/tender");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

module.exports = {
  save(file) {
    const targetPath = path.join(uploadDir, file.originalname);
    fs.copyFileSync(file.path, targetPath);
    fs.unlinkSync(file.path);
    return targetPath;
  },
};
