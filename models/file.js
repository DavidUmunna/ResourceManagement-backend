const mongoose = require("mongoose");
const {v4:uuidv4}=require("uuid")
const fileSchema = new mongoose.Schema({
    staff:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
   },
   files:[ {
    storedName: {
        type: String,
        default: function () {
            return uuidv4()
        },
    } ,
    filename: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now },
    driveFileId:{type:String},
    viewLink:{type:String},
    downloadLink:{type:String},
    gcsObjectName:{type:String},
    gcsBucket:{type:String}
    }]
});

module.exports = mongoose.model("File", fileSchema);
