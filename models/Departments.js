const mongoose=require("mongoose")

const DepartmentSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: [
      "waste_management_dep", "PVT", "Environmental_lab_dep", "accounts_dep",
      "Human resources", "Administration", "IT", "QHSE_dep",
      "Procurement_department", "Contracts_Department", "Business_Development",
      "Engineering_Department", "Visitor"
    ],
    required: true,
    unique: true
  }
}, { timestamps: true });

export const Department = mongoose.model("Department", DepartmentSchema);
