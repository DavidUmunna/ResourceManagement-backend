const {Schema, model}=require('mongoose')


const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique:true},
  password: { type: String, required: true,select:true },
  Department:{type:String, enum:["waste_management_dep","PVT","Environmental_lab_dep","accounts_dep","Human resources","Administration",
    "IT","QHSE_dep","Procurement_department","Contracts_Department","Business_Development","Engineering_Department","Visitor"]},
  role: { type: String, enum: ["admin", "procurement_officer","human_resources","staff",
    "internal_auditor","Financial_manager","global_admin","Waste Management Manager","Waste Management Supervisor","Logistics Manager",
    "PVT_manager","lab_supervisor","Environmental_lab_manager","Accountant","Director","QHSE Coordinator","Documentation_officer",
    "Contracts_manager","BD_manager","Engineering_manager","Visitor","Facility Manager"], default: "staff" },
  canApprove: {
      type: Boolean,
      default: false
    },
  WorkStatus:{type:String,enum:["On-Site","On-Leave","Remote"]},
  NotificationToken:{type:String},
  resetToken:String,
  resetTokenExpiration:Date
  
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Virtual reverse-reference: populate a user's leave balances across years
// Usage: User.findById(id).populate('leaveBalances')
UserSchema.virtual('leaveBalances', {
  ref: 'LeaveBalance',
  localField: '_id',
  foreignField: 'user',
});


module.exports=model("user", UserSchema);
