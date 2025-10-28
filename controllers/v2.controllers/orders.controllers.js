const orderservice=require("../../services/order.service")
const {getPagination,getPagingData}=require("../../Global_Functions/pagination")

exports.getAllOrders=async(req,res)=>{
    try{
        const { page, limit, skip } = getPagination(req);

        const orders=await orderservice.getAllOrders(req.user)
        return res.status(200).json({data:orders.orders,Pagination:getPagingData(orders.total,page,limit)})

    }catch(error){
        return res.status(500).json({message:"Server Error"})
    }
}

exports.getDepartmentOrders=async(req,res)=>{
    try{
        const { Department } = req.query;
        const { page, limit, skip } = getPagination(req);

        const serviceResponse=await orderservice.getDepartmentalOrders(req.user,Department)

        return res.status(200).json({data:serviceResponse.response,Pagination:getPagination(serviceResponse.total,page,limit)})

    }catch(error){
        return res.status(500).json({message:"Server Error"})
    }
}


exports.getStaffOrders=async(req,res)=>{
    try{
        const { id } = req.params;
        const { page, limit } = getPagination(req);
        if (!id) {
        return res.status(400).json({ error: "Email is required" });
        }

        const serviceResponse=await orderservice.getStaffOrders(req.user)
        return res.status(200).json({data:serviceResponse.orders,
            Pagination: getPagingData(serviceResponse.total, page, limit)
        })


    }catch(error){
        return res.status(500).json({message:"Server Error"})

    }
}

exports.getAllOrdersForDepartment=async(req,res)=>{
    try{
        const serviceResponse=await orderservice.getDisplayOrders(req.user)

        return res.status(200).status({data:serviceResponse.data})

    }catch(error){
        console.error("Error fetching department orders:", error);
         return res.status(500).json({message:"Server Error"})
    }
}
exports.getDepartmentDisplayOrders=async(req,res)=>{
    try{
        const serviceResponse=await orderservice.getDepartmentDisplayOrders(req.user)
        return res.status(200).json({data:serviceResponse.data})
    }catch(error){
        console.error("Error fetching department display  orders:", error);
        return res.status(500).json({message:"Server Error"})
    }
}

exports.getStaffDisplayOrders=async(req,res)=>{
    try{
        const serviceResponse=await orderservice.getStaffDisplayOrders(req.user)
        return res.status(200).json({data:serviceResponse.data})



    }catch(error){
        console.error("Error fetching Staff display  orders:", error);
        return res.status(500).json({message:"Server Error"})

    }
}

exports.createOrder=async(req,res)=>{
    try{
         const { supplier, orderedBy, products,email,filenames,
               urgency,remarks,Title,staff,role,targetDepartment } = req.body;
        // Ensure products is an array and destructure its fields
        if (!Array.isArray(products)) {
          return res.status(400).json({ error: "Products must be an array" });
        }
        const {Department}=req.user.Department
        
        const payload={
            supplier,
            Title,
            orderedBy,
            email,
            products,
            urgency,
            filenames,
            remarks,
            Department,
            staff,
            role,
            fileRefs: req.body.fileRefs,    
            targetDepartment
        }
        

        const serviceResponse=await orderservice.createOrder(payload,req.user,res)
        res.status(200).json({success:true,data:serviceResponse.data})


    }catch(error){
        console.error("Error Creating orders:", error);
        return res.status(500).json({message:"Server Error"})

    }
}

exports.exportOrder=async(req,res)=>{
    try{
        const {startDate,endDate,status,filename}=req.body;

        if (!startDate || !endDate || !filename) {
      return res.status(400).json({ message: "startDate, endDate, and filename are required" });
      }


      const start = new Date(startDate);
      const end = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (start > end) {
      return res.status(400).json({ message: "startDate must be before endDate" });
    }
    const payload={start,end,status,filename}

    await orderservice.exportOrder(payload,res)



    }catch(error){
    console.error("Error exporting orders:", error);
    res.status(500).json({ message: "Server error during export" });
    }
}

exports.createMemo=async(req, res)=>{
  try {
    const { requestId } = req.body;
    const { buffer, filename } = await orderservice.generateMemo(requestId);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (error) {
    console.error("Memo generation error:", error);
    if (error.message === "Request not found") {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: "Internal server error" });
  }
}

exports.approveOrderController=async(req, res)=>{
  const { id: orderId } = req.params;
  const { adminName, comment, SignatureData } = req.body;
  const user = req.user;

  try {
    await orderservice.approveOrder(orderId, adminName, comment, SignatureData, user, req.headers);
    return res.status(200).json({ message: "Approval recorded successfully" });
  } catch (error) {
    console.error("Error approving order:", error);

    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }

    return res.status(500).json({ message: "Error processing approval" });
  }
}

exports.completeOrder = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    const user = req.user;

    await orderservice.completeOrder(orderId, user);

    res.status(200).json({ message: "Request completed" });
  } catch (error) {
    console.error("Error completing order:", error);
    res.status(error.status || 500).json({ message: error.message, error });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id: orderId } = req.params;

    const updatedOrder = await orderservice.updateStatus(orderId, status);

    res.json(updatedOrder);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message, error });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const { id: orderId } = req.params;
    await orderservice.deleteOrder(orderId);
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message, error });
  }
};

exports.deleteAllOrders = async (req, res) => {
  try {
    await orderservice.deleteAll();
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message, error });
  }
};

exports.ReviewedRequests=async(req,res)=>{
    try{
        const {orderId}=req.query

        if (!orderId){
             return res.status(400).json({success:false, message:"missing OrderId"})
        }
        const serviceResponse=await orderservice.ReviewedRequests(orderId)
        
        if(!serviceResponse){
            return res.status(404).json({success:false,message:"Order not found"})
        }

        res.status(200).json({success:true,data:serviceResponse.data})

    }catch(error){
           console.error("Error in operation", error);
    res.status(500).json({ success: false, message: "Error in processing" });

    }
}



exports.getOverallMonthlyRequests=async(req,res)=>{
    try{
        const {Department}=req.query

        const serviceResponse=await orderservice.GetOverallMonthlyRequests(Department)
        res.status(200).json({data:Department?serviceResponse.data:serviceResponse.Request})

    }catch(error){
        console.error("An error occurred", error);
        res.status(500).json({ message: "Server Error" });
    }
}