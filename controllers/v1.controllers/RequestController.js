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
        const Requests = await PurchaseOrder.find(query).populate("staff")
        const filteredRequests=Requests.filter((request)=>{
            const plainRequest=request.toObject()
            if(Department){
                return plainRequest.staff.Department===Department
            }
            return true
        }
        
        )
        const totalDailyRequests=filteredRequests.length
 

        res.status(200).json({
            message: "Total requests for today",
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
    const DepartmentsWithManagers = ["waste_management_dep", "PVT", "Environmental_lab_dep"];
    const MD_id = "6830789898ef43e5803ea02c";
    const NewRequest = await PurchaseOrder.findById(requestId).populate("staff");
    if (!NewRequest) throw new Error("Request not found");

    const allUsers = await users.find().lean();

    const filterApprovers = (department, requestOwnerRole) => {
  return allUsers.filter(user => {
    // --- EXCLUSION RULE ---
    // Facility Manager cannot approve Waste Management Manager requests
    if (
      requestOwnerRole === "Waste Management Manager" &&
      user.role === "Facility Manager"
    ) {
      return false;
    }

    // --- EXISTING FILTERS ---
    return (
      (user.WorkStatus!=="On-Leave")&&
      (
        user._id.toString() !== NewRequest.staff._id.toString() || // allow only if MD
        user._id.toString() === MD_id
      ) &&
      (
        (user.canApprove && user.Department === department && user.role !== "global_admin") ||
        (user.canApprove && !Managers.includes(user.role) && user.Department === department && user.role !== "global_admin") ||
        SecondLevel.includes(user.role) ||
        user._id.toString() === MD_id
      )
        );
      });
    };


    const requiredApprovers = NewRequest.targetDepartment
    ? filterApprovers(NewRequest.targetDepartment, NewRequest.staff.role)
    : filterApprovers(NewRequest.staff.Department, NewRequest.staff.role);


    NewRequest.PendingApprovals = requiredApprovers.map(user => {
      let level = 1;
      if (SecondLevel.includes(user.role)) level = 2;
      if (user._id.toString() === MD_id) level = 3;
      return { Reviewer: user._id, Level: level };
    });

    await NewRequest.save();
  } catch (error) {
    console.error("Error validating approvers", error);
  }
};

const UnresolvedOrders=async(req,res)=>{
  try{
    const {userId,Department,role}=req.user
    const {page,limit,skip}=getPagination(req)
    const {date}=req.query;
    const query={}
    console.log(req.query)
    
    if(date==="yesterday"){
      query.createdAt=new Date(Date.now()-(24*60*60*1000))
    }else if(date==="Last 7 Days"){
      const yesterday=new Date(Date.now()-(24*60*60*1000))
      const AweektoYesterday=new Date(Date.now()-7*24*60*60*1000)
      query.createdAt={$gte:AweektoYesterday,$lte:yesterday}
    }else if(date==="Last 30 Days"){
      const yesterday=new Date(Date.now()-(24*60*60*1000))
      const AMonthtoYesterday=new Date(Date.now()-30*24*60*60*1000)
      query.createdAt={$gte:AMonthtoYesterday,$lte:yesterday}
    }else if(date==="Last 365 Days"){
      const yesterday=new Date(Date.now()-(24*60*60*1000))
      const AYeartoYesterday=new Date(Date.now()-365*24*60*60*1000)
      query.createdAt={$gte:AYeartoYesterday,$lte:yesterday}
    }
    const Managers=["Waste Management Manager","Contracts_manager",
    "Financial_manager","Environmental_lab_manager","Facility Manager"]
    const subordinates=["Facility Manager","Waste Management Supervisor","lab_supervisor"]
    let filteredOrders;
    let paginatedOrders;
    let total;
    //console.log("query",query)

    const orders=await PurchaseOrder.find(query).populate("staff", "-password -__v -role -canApprove -_id")
           .populate("PendingApprovals.Reviewer","-password -__v ")
           .populate("EditedBy","-password -__v")
             .sort({ createdAt: -1 })
             .skip(skip)
             .limit(limit)      
  


    if(role=="Staff"){
      return res.status(403).json({message:"you are not authorized to view "})
    }
    filteredOrders=orders
    total=filteredOrders.length
    paginatedOrders=filteredOrders.slice(skip,skip+limit)
    if(Managers.includes(role)){
      
      filteredOrders=orders.filter(order => 
        {if (!order.targetDepartment){
          
          return order.staff?.Department === Department
        }
        return order.targetDepartment===Department}
      )
    }else if(subordinates.includes(role)){
      const NewFilteredOrders= filteredOrders.filter(order=>
        !Managers.includes(order.staff.role)
      )

      total=NewFilteredOrders.length
      paginatedOrders=NewFilteredOrders.slice(skip,skip+limit)

    }else{
      total=filteredOrders.length;
      paginatedOrders=filteredOrders.slice(skip,skip+limit)
    }
    //console.log("paginated",paginatedOrders)

  const response = paginatedOrders.filter(order => {
  const plainOrder = order.toObject();

  // Find the minimum level in PendingApprovals
  const minLevel = Math.min(...plainOrder.PendingApprovals.map(a => a.Level));

  // Return true if the user is one of the reviewers at that minimum level
  return plainOrder.PendingApprovals.some(user_ => {
    const reviewerId = user_.Reviewer?._id?.toString() || user_.Reviewer?.toString();
    return user_.Level === minLevel && reviewerId === userId.toString();
  });
  });


   


    res.json({data:response,
      Pagination:getPagingData(total,page,limit)});

  }catch(error){
    console.error("an error occured here",error)
    res.status(500).json({message:"there was an error"})
  }
}



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