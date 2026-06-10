const users=require("../../models/users_")
const PurchaseOrder = require("../../models/PurchaseOrder")
const {  StaffResponseAlert,MoreInformationAlert } = require("./notification")
//const requests=require("../models/PurchaseOrder")
const {getPagination,getPagingData}=require("../../Global_Functions/pagination")
const ReviewedRequests = async (req, res) => {
  try {
    const { orderId } = req.query
    //console.log("orderId:", req.query);

    if(!orderId){
      return res.status(400).json({success:false, message:"missing OrderId"})
    }

    const request = await PurchaseOrder.findById(orderId);

    if (!request) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const Approvals = request.Approvals?.filter(
      (admin) => admin.status === "More Information"
    ) || [];
    const Approval_names=Approvals.map(a=>(a.admin))

    res.status(200).json({ success: true, data: Approval_names });

  } catch (error) {
    console.error("Error in operation", error);
    res.status(500).json({ success: false, message: "Error in processing" });
  }
};
const GetOverallMonthlyRequests = async (req, res) => {
    try {
        const {Department}=req.query
        const query={}
        const now = new Date();
        const startOfDay = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
        
            1, 0, 0, 0
        ));
     
        
        const endOfDay = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth()+1,
            0,23, 59, 59, 999
        ));
       
        query.createdAt = {
            $gte: startOfDay,
            $lte: endOfDay,
        };
        const Requests = await PurchaseOrder.find(query).populate("staff", "name email Department -password").lean()

        
        const filteredRequests=Requests.filter((request)=>{
            
            plainRequest=JSON.stringify(request, null, 2)
            if(Department){
                return request.staff?.Department===Department
            }
            return true
        }
        
        )
       
        
        const totalDailyRequests=filteredRequests.length
 

        res.status(200).json({
            message: "Total requests for the month",
            total: filteredRequests.length,
            data: Department? filteredRequests:Requests
        });
    } catch (error) {
        console.error("An error occurred", error);
        res.status(500).json({ message: "Server Error" });
    }
};

const MonthlyStaffRequest=async(req,res)=>{
    try{
        const {userId}=req.query
        
        const query={}
        if (userId){
            query.staff=userId
        }
       
      
        const now = new Date();
        const startOfDay = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            0, 0, 0, 0
        ));

        const endOfDay = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),

            23, 59, 59, 999
        ));

        query.createdAt = {
            $gte: startOfDay,
            $lte: endOfDay,
        };
        const Requests = await PurchaseOrder.find(query)

     

        res.status(200).json({
            message: "Total requests for today",
            data: Requests,
        });


    }catch(error){
        console.error("An error occurred staff Requests", error);
        res.status(500).json({ message: "Server Error" });
 
    }
}

const UpdateExistingRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const {userId}=req.user
    const { Title, supplier, remarks, products } = req.body;

    const updateform = {};
    if (Title) updateform.Title = Title;
    if (supplier) updateform.supplier = supplier;
    if (remarks) updateform.remarks = remarks;
    if (products) updateform.products = products;
    if (userId) updateform.EditedBy=userId;
    const updatedRequest = await PurchaseOrder.findByIdAndUpdate(
      id,
      updateform,
      { new: true })
      .populate("staff", "-password -__v  -canApprove -_id")
      .populate("PendingApprovals")
      .populate("EditedBy");

    if (!updatedRequest) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    return res.status(200).json({ success: true, data: updatedRequest });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};


  

const MoreInformation=async(req,res)=>{
    const {id:orderId}=req.params
    const {adminName,comment}=req.body
    const user=req.user
    if (!user.canApprove){
        return res.status(403).json({message:'you are not authorized to approve requests'})
    }
    try{
  
        const request=await PurchaseOrder.findById(orderId)
        if (!request){
            return res.status(404).json({message:"request not found"})
        }
        const approvingUser = await users.findOne({ name: adminName });
        if (!approvingUser) {
          return res.status(404).json({ message: "Approving user not found" });
        }
        request.Approvals=(request.Approvals||[]).filter(
            a=>a.admin!==adminName
        )

        const newDecision={
            admin:adminName,
            status:"More Information",
            comment:comment,
            timestamp:new Date()
        }

        request.Approvals.push(newDecision)
       
        const prev_Request=await request.save()
        MoreInformationAlert(prev_Request._id)
        return res.status(200).json({
            success:true,
            message:"successful operation"
        })

    }catch(error){
        console.error("Error in operation",error)
        res.status(500).json({success:false,message:"Error In processing "})
    }

}


const StaffResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, admin } = req.body;

    // Input validation
  
    if (!message || !admin) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Fetch the purchase order
    const response = await PurchaseOrder.findById(id);
    if (!response) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }
   
    // Add the staff response
    const newStaffResponse = {
      admin,
      message,
      timestamps: new Date().toISOString() // optional: if you want to track time
    };

    response.staffResponse.push(newStaffResponse);
  
    // Save updated document
    const savedResponse = await response.save();

    // Trigger alert or notification
    StaffResponseAlert(response._id);

    // Send response
    return res.status(200).json({
      success: true,
      message: "Response added successfully",
      data: savedResponse.staffResponse // optional: return updated responses
    });

  } catch (error) {
    console.error("Error in StaffResponse:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const GetStaffResponses=async(req,res)=>{
    try{
        const {orderId}=req.query
        if(!orderId){
            return res.status(404).json({success:false,message:"document not found"})
        }
       
        const Request=await PurchaseOrder.findById(orderId)
        let ResponseList=Request.staffResponse.map(response=>{
            const plain=response.toObject()
            return plain
        })
        return res.status(200).json({success:true,data:ResponseList, message:"successsful Request"})
       
    }catch(error){
        console.error("Error in operation",error)
        res.status(500).json({success:false,message:"Error In processing "})

    }
}
const ValidatePendingApprovals = async (requestId) => {
  try {
      const SecondLevel = ["human_resources", "internal_auditor"];
      const Managers = ["Waste Management Manager", "Contracts_manager", "Financial_manager", "Environmental_lab_manager","Facility Manager"];    
    const NewRequest = await PurchaseOrder.findById(requestId).populate("staff");
    if (!NewRequest) throw new Error("Request not found");

    const allUsers = await users.find().lean();

   const filterApprovers = (department, requestOwnerRole) => {
  return allUsers.filter(user => {

    // ❌ Exclude request owner
    if (user._id.toString() === NewRequest.staff._id.toString()) {
      return false;
    }

    // ❌ Exclude people on leave
    if (user.WorkStatus === "On-Leave") {
      return false;
    }

    // ❌ Special exclusion rule
    if (
      requestOwnerRole === "Waste Management Manager" &&
      user.role === "Facility Manager"
    ) {
      return false;
    }

    // ✅ Level 1: Department approvers (Managers)
    const isDepartmentManager =
      user.canApprove &&
      user.Department === department &&
      Managers.includes(user.role);

    // ✅ Level 2: Global/Second-level approvers
    const isSecondLevel =
      SecondLevel.includes(user.role)&& user.canApprove;

    return isDepartmentManager || isSecondLevel;
  });
};

    const requiredApprovers = NewRequest.targetDepartment
    ? filterApprovers(NewRequest.targetDepartment, NewRequest.staff.role)
    : filterApprovers(NewRequest.staff.Department, NewRequest.staff.role);

let finalApprovers=requiredApprovers;

if (requiredApprovers.length === 0) {
  const fallbackApprovers = allUsers.filter(u =>
    u.canApprove &&
    u.WorkStatus !== "On-Leave" &&
    u._id.toString() !== NewRequest.staff._id.toString()
  );

  if (fallbackApprovers.length === 0) {
    throw new Error("No available approvers in the system.");
  }

  finalApprovers = fallbackApprovers;
}

  NewRequest.PendingApprovals = finalApprovers.map(user => {
  let level = 1;

  if (SecondLevel.includes(user.role)) {
    level = 2;
  }

  return {
    Reviewer: user._id,
    Level: level
  };
});

    await NewRequest.save();
  } catch (error) {
    console.error("Error validating approvers", error);
  }
};

const UnresolvedOrders = async (req, res) => {
  try {
    const { userId, Department, role } = req.user;
    const { page, limit, skip } = getPagination(req);
    const { date } = req.query;

    const query = {};

    // ✅ Date filter (cleaned)
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (date === "yesterday") {
      query.createdAt = {
        $gte: new Date(now - oneDay),
        $lte: new Date(now)
      };
    } else if (date === "Last 7 Days") {
      query.createdAt = {
        $gte: new Date(now - 7 * oneDay),
        $lte: new Date(now)
      };
    } else if (date === "Last 30 Days") {
      query.createdAt = {
        $gte: new Date(now - 30 * oneDay),
        $lte: new Date(now)
      };
    } else if (date === "Last 365 Days") {
      query.createdAt = {
        $gte: new Date(now - 365 * oneDay),
        $lte: new Date(now)
      };
    }

    // ❌ Block staff early
    if (role === "Staff") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const Managers = [
      "Waste Management Manager",
      "Contracts_manager",
      "Financial_manager",
      "Environmental_lab_manager",
      "Facility Manager"
    ];

    const subordinates = [
      "Facility Manager",
      "Waste Management Supervisor",
      "lab_supervisor"
    ];

    // ✅ Fetch once (NO double pagination)
    const orders = await PurchaseOrder.find(query)
      .populate("staff", "-password -__v -role -canApprove -_id")
      .populate("PendingApprovals.Reviewer", "-password -__v")
      .populate("EditedBy", "-password -__v")
      .sort({ createdAt: -1 });

    // ✅ Role-based filtering
    let filteredOrders = orders;

    if (Managers.includes(role)) {
      filteredOrders = orders.filter(order => {
        if (!order.targetDepartment) {
          return order.staff?.Department === Department;
        }
        return order.targetDepartment === Department;
      });
    } else if (subordinates.includes(role)) {
      filteredOrders = orders.filter(order =>
        !Managers.includes(order.staff?.role)
      );
    }

    // ✅ Approval filtering (core logic)
    const actionableOrders = filteredOrders.filter(order => {
      if (!order.PendingApprovals || order.PendingApprovals.length === 0) {
        return false;
      }

      const minLevel = Math.min(...order.PendingApprovals.map(a => a.Level));

      return order.PendingApprovals.some(a => {
        const reviewerId =
          a.Reviewer?._id?.toString() || a.Reviewer?.toString();

        return a.Level === minLevel && reviewerId === userId.toString();
      });
    });

    // ✅ Pagination happens LAST (correct way)
    const total = actionableOrders.length;
    const paginatedOrders = actionableOrders.slice(skip, skip + limit);

    res.json({
      data: paginatedOrders,
      Pagination: getPagingData(total, page, limit)
    });

  } catch (error) {
    console.error("Error fetching unresolved orders:", error);
    res.status(500).json({ message: "There was an error" });
  }
};



const DeleteStaffResponse = async (req, res) => {
    try {
        const { id } = req.params;
        const { responseId } = req.query;

        if (!id) {
            return res.status(400).json({ success: false, message: "Document ID is required" });
        }
        if (!responseId) {
            return res.status(400).json({ success: false, message: "Response ID is required" });
        }

        const Request = await PurchaseOrder.findById(id);
        if (!Request) {
            return res.status(404).json({ success: false, message: "Document not found" });
        }

        // Convert to string for comparison if needed
        const responseIdStr = responseId.toString();
        
        // Filter out the response to be deleted
        const initialLength = Request.staffResponse.length;
        Request.staffResponse = Request.staffResponse.filter(response => {
            return response._id.toString() !== responseIdStr;
        });

        if (Request.staffResponse.length === initialLength) {
            return res.status(404).json({ 
                success: false, 
                message: "Response not found in document" 
            });
        }

        await Request.save();
        return res.status(200).json({ 
            success: true, 
            message: "Delete successful",
            data: Request.staffResponse 
        });

    } catch (error) {
        console.error("Error in DeleteStaffResponse:", error);
        res.status(500).json({ 
            success: false, 
            message: "Server error",
            error: error.message 
        });
    }
};


module.exports={StaffResponse,MoreInformation,ReviewedRequests,DeleteStaffResponse,
    GetStaffResponses,ValidatePendingApprovals,GetOverallMonthlyRequests,MonthlyStaffRequest,
    UpdateExistingRequest,UnresolvedOrders  };