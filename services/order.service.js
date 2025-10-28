const { ValidatePendingApprovals } = require("../controllers/v1.controllers/RequestController");
const orderRepository=require("../repositories/order.repository");
const exportToExcelAndUpload = require("../Uploadexceltodrive");
const ExcelJS=require("exceljs")
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  TableBorders
} = require("docx");
const { UAParser } = require("ua-parser-js");
const { findOrderById, saveOrder, findUserByName } = require("../repositories/orders.repositories");
const { CreateSignature } = require("../utils/signature");
const { ApprovedRequests } = require("../utils/workflows");

const {RequestActivity}= require("../controllers/v1.controllers/notification");


exports.getAllOrders=async(user)=>{
    query={}
   let queryWithApprovals
    if (req.user.userId==='6830789898ef43e5803ea02c'){
      queryWithApprovals = {
      ...query,
      $or:[
        {"staff":req.user.userId},
        {"status":"Completed"},
        {
          PendingApprovals: { 
            $not: { $elemMatch: { Level: {$in:[1,2]} } }
          }
        }
        
      ]
    };
    }if(req.user.role==='Accountant' || req.user.role==="Financial_manager"){
       queryWithApprovals = { 
        ...query,
        $expr: {
        $gte: [
          {
            $size: {
              $filter: {
                input: "$Approvals",
                as: "admin",
                cond: { $eq: ["$$admin.status", "Approved"] }
              }
            }
          },
          2
        ]
      }};

    }
    else{

      queryWithApprovals = {
        ...query,
        $or:[
          {"staff":req.user.userId},
          {"status":{$in:["Completed","Approved"]}},
          {
            PendingApprovals: { 
              $not: { $elemMatch: { Level: 1 } }
            }
          }
          
        ]
      };
    }

    return await orderRepository.getPaginatedOrders(queryWithApprovals)
}


exports.getDepartmentalOrders=async(user,Department)=>{
  try{
    let total;
    let paginatedOrders;
    let query={
      $or:[
        {"staff":req.user.userId},
        {"status":{$in:["Completed","Approved"]}},
        {"PendingApprovals.Level": {$in:[1]}}
        
      ]
    }
    const Managers=["Waste Management Manager","Contracts_manager",
    "Financial_manager","Environmental_lab_manager","Facility Manager"]
    const subordinates=["Facility Manager","Waste Management Supervisor","lab_supervisor"]


    const allOrders=await orderRepository.getOrders(query)

    const filteredOrders = allOrders.filter(order => 
     {if (!order.targetDepartment){

        return order.staff?.Department === Department
      }
      return order.targetDepartment===Department}
    );
    if(subordinates.includes(req.user.role)){
      const NewFilteredOrders= filteredOrders.filter(order=>
        !Managers.includes(order.staff.role)
      )

      total=NewFilteredOrders.length
      paginatedOrders=NewFilteredOrders.slice(skip,skip+limit)
    }else{

      
      total = filteredOrders.length;
      paginatedOrders = filteredOrders.slice(skip, skip + limit);
    }


    const response = paginatedOrders.map(order => {
      const plainOrder = order.toObject();
      /*if (!globalRoles.includes(req.user.role)) {
        delete plainOrder.Approvals;
      }*/
      return plainOrder;
    });
    return {response:response,total:total}


  }catch(error){

  }
}
exports.getStaffOrders=async(user)=>{
  const query={}
  query.staff=user.userId
  return await orderRepository.getPaginatedOrders(query)
}

exports.getDepartmentDisplayOrders=async(user)=>{
 const UserDepartment=user.Department
 const repositoryResponse=await orderRepository.getDepartmentDisplayORders()
 const filteredOrders = repositoryResponse.data.filter(order => 
     {if (!order.targetDepartment){

        return order.staff?.Department === UserDepartment
      }
      return order.targetDepartment===UserDepartment}
    );
  return {data:filteredOrders}

  }

exports.getStaffDisplayOrders=async(user)=>{
    
    const response=await orderRepository.getStaffDisplayOrders(user)
    const filteredOrders=response.data.map((order)=>{
      const plainOrder=order.toObject();
      return plainOrder
    })

    return {data:filteredOrders,total:response.total}
}

exports.createOrder=async(payload,user,res)=>{
   const {email}=user

   const User=await user.findOne({email})
   if (!User) {
         return res.status(404).json({ error: "User not found" });
   }   
   const repositoryResponse=await orderRepository.createOrder(payload)
   ValidatePendingApprovals(repositoryResponse.data._id)
   await exportToExcelAndUpload(repositoryResponse.data._id)
   return {data:repositoryResponse.data}
}


exports.exportOrder=async(payload,res)=>{
  const query={
    createdAt:{
      $gte:payload.start,
      $lte:payload.end
    }
  }
  if (payload.status && payload.status!=="All"){
    query.status=payload.status
  }
  if (payload.filename && typeof payload.filename==="string"){

      const sanitizedFileName = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
      const timestamp = Date.now();
      
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${sanitizedFileName}-${timestamp}.xlsx`);
    }
  const repositoryResponse=await orderRepository.exportOrder(query)
  const requestItems=repositoryResponse.data
    const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Purchase Requests');
      
      // Define headers
      worksheet.columns = [
        { header: "Request Title", key: "title", width: 20 },
        { header: "Ordered By", key: "orderedBy", width: 20 },
        { header: "Email", key: "email", width: 30 },
        { header: "Product Name", key: "productName", width: 20 },
        { header: "Product Quantity", key: "productQuantity", width: 20 },
        { header: "Product Price", key: "productPrice", width: 20 },
        { header: "Remarks", key: "remarks", width: 25 },
        { header: "Urgency", key: "urgency", width: 20 },
        { header: "Status", key: "status", width: 20 },
        { header: "Department", key: "department", width: 20 },
        { header: "Date Created", key: "createdAt", width: 20 },
      ];
  
      // Add rows for each product in each request
      requestItems.forEach((item) => {
        
        if (item.products && item.products.length > 0) {
          item.products.forEach((product) => {
            
            worksheet.addRow({
              title: item.Title,
              orderedBy: item.staff?.name || '',
              email: item.staff?.email || '',
              productName: product.name || '',
              productQuantity: product.quantity || 0,
              productPrice: product.price || 0,
              remarks:item.remarks || '',
              urgency: item.urgency,
              status: item.status,
              department: item.staff?.Department || '',
              createdAt:item.createdAt instanceof Date
              ? item.createdAt.toISOString().slice(0, 10)
              : (item.createdAt?.slice(0, 10) || '')
            });
           
          });
        } else {
          // Add row even if no products (with empty product fields)
          worksheet.addRow({
            title: item.Title,
            orderedBy: item.staff?.name || '',
            email: item.staff?.email || '',
            productName: '',
            productQuantity: '',
            productPrice: '',
            remarks:item.remarks||'',
            urgency: item.urgency,
            status: item.status,
            department: item.staff?.Department || '',
            createdAt:item.createdAt instanceof Date
              ? item.createdAt.toISOString().slice(0, 10)
              : (item.createdAt?.slice(0, 10) || '')
          });
        }
      });
  await workbook.xlsx.write(res)
  res.end();
}
exports.generateMemo=async(requestId)=>{
  const request = await orderRepository.findPurchaseOrderById(requestId);

  if (!request) {
    throw new Error("Request not found");
  }

  const imagePath = path.join(__dirname, "../assets/haldenlogo_1.png");

  // Build the Word document (moved from controller to here)
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: fs.readFileSync(imagePath),
                transformation: { width: 50, height: 50 },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: "INTERNAL MEMORANDUM",
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            border: {
              bottom: { color: "000000", space: 20, style: BorderStyle.SINGLE, size: 8 }
            },
            spacing: { after: 600 }
          }),
          // ⚡ memo metadata table, products, approvals etc...
          // (keep your existing docx building code here)
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `memo-${request.orderNumber}.docx`;

  return { buffer:buffer, filename:filename };
}

exports.approveOrder=async(orderId, adminName, comment, SignatureData, user, headers)=>{
  if (!user.canApprove) {
    throw { status: 403, message: "You are not authorized to approve requests" };
  }

  const order = await findOrderById(orderId);
  if (!order) {
    throw { status: 404, message: "Order not found" };
  }

  const ip = headers["x-forwarded-for"] || headers["socket-remoteAddress"];
  const parser = new UAParser(headers["user-agent"]);
  const deviceInfo = parser.getResult();
  const device = deviceInfo.device;

  // Remove any previous decisions from this admin
  order.Approvals = (order.Approvals || []).filter(a => a.admin !== adminName);

  const approvingUser = await findUserByName(adminName);
  if (!approvingUser) {
    throw { status: 404, message: "Approving user not found" };
  }

  const pendingApprovalsIds = order.PendingApprovals.map(u => u.Reviewer.toString());
  if (!pendingApprovalsIds.includes(user.userId.toString())) {
    throw { status: 403, message: "You are not authorized to approve this request" };
  }

  let SavedSignature;
  const newApproval = {
    admin: adminName,
    status: "Approved",
    comment,
    timestamp: new Date(),
  };

  if (SignatureData) {
    SavedSignature = await CreateSignature(user.userId, SignatureData, ip, device);
    newApproval.signature = SavedSignature;
  }

  order.Approvals.push(newApproval);

  if (order.PendingApprovals && order.PendingApprovals.length > 0) {
    order.PendingApprovals = order.PendingApprovals.filter(
      u => u.Reviewer.toString() !== approvingUser._id.toString()
    );
  }

  const updatedOrder = await saveOrder(order);

  if (updatedOrder.Approvals.length > 3) {
    ApprovedRequests(updatedOrder._id);
  }

  return {data:updatedOrder}
}


exports.completeOrder = async (orderId, user) => {
  if (!user.canApprove) {
    const error = new Error("You are not authorized");
    error.status = 403;
    throw error;
  }

  const order = await orderRepository.findOrderById(orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  const savedOrder = await orderRepository.markOrderCompleted(order);

  // Trigger activity log
  RequestActivity(savedOrder._id);

  return savedOrder;
};

const validStatuses = [
  "Pending",
  "Completed",
  "Rejected",
  "Approved",
  "More Information",
  "Awaiting Funding",
];

exports.updateStatus = async (orderId, status) => {
  if (!validStatuses.includes(status)) {
    const error = new Error("Invalid status value");
    error.status = 400;
    throw error;
  }

  const updatedOrder = await orderRepository.updateOrderStatus(orderId, status);
  if (!updatedOrder) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  return updatedOrder;
};

exports.deleteOrder = async (orderId) => {
  const deletedOrder = await orderRepository.deleteOrderById(orderId);
  if (!deletedOrder) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  return deletedOrder;
};

exports.deleteAll = async () => {
  await orderRepository.deleteAllOrders();
};

exports.ReviewedRequests=async(orderId)=>{

  const repositoryResponse=await orderRepository.findOrderById(orderId)
  const Approvals = repositoryResponse.Approvals?.filter(
    (admin) => admin.status === "More Information"
  ) || [];
  const Approval_names=Approvals.map(a=>(a.admin))
  return {data:Approval_names}
}


exports.GetOverallMonthlyRequests=async()=>{
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

    const repositoryResponse=await orderRepository.getOrders(query)
    const requests=repositoryResponse.orders
     const filteredRequests=requests.filter((request)=>{
            const plainRequest=request.toObject()
            if(Department){
                return plainRequest.staff.Department===Department
            }
            return true
        }
        
        )
  return {data:filteredRequests,Request:Request,total:filteredRequests.length}

}

