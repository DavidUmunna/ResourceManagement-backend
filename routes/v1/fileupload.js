const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const file_=require("../../models/file")
const upload = multer({ dest: "tempUploads/" });
const { uploadFileToDrive } = require("../../googledriveservice");
const router = express.Router();
const { downloadFileFromDrive } = require("../../googledriveservice")
const sanitize=require("sanitize-filename")
const csrf=require("csurf")
const csrfProtection=csrf({cookie:true})

//console.log("path variable",path)
const uploadDir = path.join("uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


 router.post("/create", upload.array("file", 5), async (req, res) => {
  try {
    const { userId } = req.body;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/csv",
      "application/vnd.ms-excel",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text",
    ];

    // Validate first
    for (const file of req.files) {
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `Unsupported file type: ${file.originalname}`,
        });
      }
    }

    // Upload only after validation passes
    const uploadedFiles = await Promise.all(
      req.files.map(async (file) => {
        const driveFile = await uploadFileToDrive(file.path, sanitize(file.originalname), file.mimetype);
        fs.unlinkSync(file.path);

        return {
          staff: userId,
          filename: file.originalname,
          driveFileId: driveFile.id,
          viewLink: driveFile.webViewLink,
          downloadLink: driveFile.webContentLink,
        };
      })
    );

    const newFile = new file_({ files: uploadedFiles });
    await newFile.save();

    return res.status(200).json({
      success: true,
      message: "Files uploaded",
      files: newFile,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Upload failed",
    });
  }
});


 router.get("/download/:fileId/:filename", async (req, res) => {
  try {
    const fileId= req.params.fileId;
    const filename=req.params.filename;
    console.log(req.params)
    const objectIdRegex = /^[a-fA-F0-9]{24}$/;
    if (!objectIdRegex.test(fileId)) {
       return res.status(400).json({ error: 'Invalid file ID format.' });
    }
    // Find the document that contains this file
    const fileDoc = await file_.findById(fileId);


    if (!fileDoc) {
      return res.status(404).json({ error: "File not found in database" });
    }
   

    // Extract the specific file object from the array
    const targetFile = fileDoc.files.find(f => f.filename===filename);

    //console.log(targetFile.driveFileId)
    if (!targetFile || !targetFile.driveFileId) {
      return res.status(404).json({ error: "Drive file ID missing" });
    }


    await downloadFileFromDrive(targetFile.driveFileId, res);
    //res.status(200).json({message:"file downloaded successfully"})
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
});
   

    

    router.get("/:id", async (req, res) => {
      try {
        const { id } = req.params;
       
    
        // Find the document that contains the file
        const fileDoc = await file_.findOne({ staff: id });
        if (!fileDoc) return res.status(404).json({ error: "File not found in DB" });
 
    
        // Extract the specific file object from the files array
        const userFiles = fileDoc.files.filter(file => file.staff === id);
        if (!userFiles || userFiles.length === 0) return res.status(404).json({ error: "File not found in document" });
    
        // Construct the correct file path using storedName
        userFiles.forEach(file => {
          const filePath = path.join(uploadDir, file.filename);
          
    
          // Check if the file exists before sending
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/octet-stream'); // For binary
            res.setHeader('Content-Disposition', `attachment; filename=${file.filename}`);
    
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);
          } else {
            res.status(404).json({ error: "File missing from server" });
          }
        });
      } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Server error" });
      }
    });
    /*router.get("/download/:filename",async(req,res)=>{
      try{
        const filename = req.params.filename;
        const filePath =path.join(uploadDir, filename);
        res.download(filePath, (err) => {
            if (err) {
                res.status(500).json({ message: "File not found or error downloading" });
            }
        });
      }catch(err){
            console.error("an error occured",err)
            res.status(500)
      }
    })*/



    
  module.exports = router;