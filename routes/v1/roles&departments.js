const express=require("express")
const auth=require("../../middlewares/check-auth");
const monitorLogger = require("../../middlewares/monitorLogger");
const router=express.Router()

router.post("/",auth,monitorLogger,async(req,res)=>{
    try{

        const item=req.body
        const rbac_object={};
       
        if (item.ADMIN_ROLES_ASSET_MANAGEMENT){
                
            rbac_object["ADMIN_ROLES_ASSET_MANAGEMENT"]=['global_admin','human_resources','internal_auditor',"financial_manager"]
        }
        if(item.ADMIN_ROLES_DASHBOARD){
            rbac_object["ADMIN_ROLES_DASHBOARD"]=["procurement_officer", "human_resources", "internal_auditor", "global_admin","lab_supervisor",
           "Financial_manager","Waste Management Manager","Accountant","Waste Management Supervisor","Environmental_lab_manager","PVT_manager","Logistics Manager",
           "QHSE Coordinator","Contracts_manager","Engineering_manager"];
    
        }
        if(item.GENERAL_ACCESS){
        rbac_object["GENERAL_ACCESS"]=["procurement_officer", "human_resources", "internal_auditor", "global_admin",
            "Financial_manager","Accountant","Director",];
            
        }
        if (item.GENERAL_ACCESS_ORDERS){
            rbac_object["GENERAL_ACCESS_ORDERS"]=["procurement_officer", "human_resources", "internal_auditor", "global_admin",
            "Director",];
            
        }
        if (item.DEPARTMENTAL_ACCESS){
            rbac_object["DEPARTMENTAL_ACCESS"]=["Waste Management Manager","PVT_manager","Environmental_lab_manager","PVT_manager","lab_supervisor",
                "Contracts_manager","Engineering_manager","Facility Manager"]
                
        }if(item.ADMIN_ROLES_GENERAL){
                rbac_object["ADMIN_ROLES_GENERAL"]=["procurement_officer", "human_resources", "internal_auditor", "global_admin","admin","lab_supervisor",
                    "Financial_manager","Waste Management Manager","Accountant","Waste Management Supervisor","Environmental_lab_manager","PVT_manager","Logistics Manager",
                    "QHSE Coordinator","Contracts_manager","Engineering_manager","admin","Facility Manager"];
        if (item.PROTECTED_USERS){
         
            rbac_object["PROTECTED_USERS"]=[
                "6830789898ef43e5803ea02c","68306b205302544582c59f35"
            ]
        }
        }if (item.ADMIN_ROLES_DEPARTMENT){
                rbac_object["ADMIN_ROLES_DEPARTMENT"]=["admin","global_admin","human_resources"]
        }if(item.DELETIONROLES){
            rbac_object["DELETIONROLES"]=["global_admin","human_resources"]
        }

        if (item.APPROVALS_LIST){
            rbac_object["APPROVALS_LIST"]=["accounts_dep"]
        }
        if(item.EDITING_ROLES){
            rbac_object["EDITING_ROLES"]=["procurement_officer","global_admin","human_resources"]
        }
        if (item.ALLROLES){
            rbac_object["ALL_ROLES"]=["procurement_officer", "human_resources", "internal_auditor", "global_admin","admin",
         "Financial_manager","Waste Management Manager","Waste Management Supervisor","Accountant","lab_supervisor","Director","Environmental_lab_manager","PVT_manager","staff",
         "Contracts_manager","Documentation_officer","Engineering_manager","QHSE Coordinator", "Logistics Manager", "Facility Manager"]
        }
        // Departments allowed to raise maintenance purchase requests, and the
        // asset category each maps to. Source of truth for the maintenance flow.
        if (item.MAINTENANCE_ASSET_ACCESS){
            rbac_object["MAINTENANCE_ASSET_ACCESS"]={
                departments: ["waste_management_dep","IT"],
                categoryByDepartment: { "waste_management_dep": "waste_management", "IT": "IT_equipment" }
            }
        }
        if (item.LEAVE_SUMMARY_ROLES){
            rbac_object["LEAVE_SUMMARY_ROLES"]=["Director","global_admin"]
        }
        if (item.LEAVE_ADMIN_ROLES){
            rbac_object["LEAVE_ADMIN_ROLES"]=["admin","global_admin"]
        }
        if (item.FEEDBACK_ADMIN_ROLES){
            rbac_object["FEEDBACK_ADMIN_ROLES"]=["global_admin"]
        }
       
        
        res.status(200).json({message:"items Delivered",data:rbac_object})
    }catch(error){
        console.error("from roles&department:",error)
        res.status(500).json({message:'an error occured'})
    }

});

module.exports=router