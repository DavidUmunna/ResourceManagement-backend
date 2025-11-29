const mongoose=require('mongoose');
const timestamp = require('timestamp');


const FileTracking=new mongoose.Schema({
    FileName:{ type:String, required:true},
    Issuer:{type:String,required:true},
    ExpiresAt:{type:Date,required:true},
    IssuedTo:{type:String},
    IssueDate:{type:Date,required:true},
    fileUrl:{type:String},
    status:{type:String, enum:['Active','Expiring','Expired'],default:'active'},
    

},{timestamps:true})

FileTracking.index({ExpiresAt:1})

FileTracking.pre("save", function (next) {
    const today = new Date();
    try{

        
        if (this.ExpiresAt) {
    if (today > this.ExpiresAt) {
      this.status = "Expired";
    }
    // Optional: check if expiring soon (e.g. 30 days)
    else {
      const daysLeft = (this.ExpiresAt - today) / (1000 * 60 * 60 * 24);

      if (daysLeft < 7) {
        this.status = "Expiring";
      } else {
        this.status = "Active";
      }
    }
}

next();
}catch(error){
    console.log(error)
}
});

module.exports=mongoose.model("filetracking",FileTracking)