const mongoose=require("mongoose")

const RoleSchema = new mongoose.Schema({
  title: {
    type: String,
    enum: [
      "admin", "procurement_officer", "human_resources", "staff",
      "internal_auditor", "Financial_manager", "global_admin",
      "Waste Management Manager", "Waste Management Supervisor",
      "Logistics Manager", "PVT_manager", "lab_supervisor",
      "Environmental_lab_manager", "Accountant", "Director",
      "QHSE Coordinator", "Documentation_officer", "Contracts_manager",
      "BD_manager", "Engineering_manager", "Visitor", "Facility Manager"
    ],
    required: true,
    unique: true
  },
  canApprove: { type: Boolean, default: false }
}, { timestamps: true });

export const Role = mongoose.model("Role", RoleSchema);
