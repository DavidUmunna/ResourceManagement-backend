const { Router } = require("express");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/PurchaseOrder");
const multer = require("multer");
const path = require("path");
const user=require("../../models/users_")
const fs = require("fs");
const file=require("../../models/file")
const auth=require("../../middlewares/check-auth")
const uploadDir = path.join(__dirname, "../uploads");
const exporttoexcel=require("../../exporttoexcel")
const router = Router();
const {getPagination,getPagingData}=require('../../Global_Functions/pagination')
const notifyAdmins=require("../../emailnotification/emailNotification");
const exportToExcelAndUpload=require("../../Uploadexceltodrive")
const products_=require("../../models/Product")
const usemonitor=require("../../middlewares/usemonitor")
const ExcelJS=require("exceljs")
const monitorLogger=require("../../middlewares/monitorLogger")
const csrf=require("csurf");
const {RequestActivity,IncomingRequest,ApprovedRequests } = require("../../controllers/v1.controllers/notification");
const csrfProtection=csrf({cookie:true})
const { Document, Packer, Paragraph,AlignmentType,BorderStyle,ImageRun,Table,TableRow,TableBorders, TableCell,HeadingLevel,WidthType } = require('docx');
const RequestController = require("../../controllers/v1.controllers/RequestController");
const {ValidatePendingApprovals,GetOverallMonthlyRequests,MonthlyStaffRequest}=require("../../controllers/v1.controllers/RequestController");
const users_ = require("../../models/users_");
const poAnalyticsController=require("../../controllers/v1.controllers/RequestsAnalytics");
const twoFactorVerify = require("../../middlewares/TwoFactorVerify");
const UAParser = require("ua-parser-js");
const { CreateSignature } = require("../../controllers/v1.controllers/Signature_Controllers");


router.get("/reviewed",auth,RequestController.ReviewedRequests)
router.delete("/:id/staffresponse",auth,RequestController.DeleteStaffResponse)
router.get("/staffresponses",auth,RequestController.GetStaffResponses)
router.get('/analytics/purchase-orders', poAnalyticsController.getPOAnalytics);
router.get('/DailyRequests',auth,GetOverallMonthlyRequests)
router.get("/StaffRequests",MonthlyStaffRequest)
// Specialized analytics endpoints
router.get('/analytics/purchase-orders/status-distribution', poAnalyticsController.getPOStatusDistribution);
router.get('/analytics/purchase-orders/urgency-stats', poAnalyticsController.getPOUrgencyStats);
router.get('/unresolvedorders',auth,RequestController.UnresolvedOrders)
router.get("/accounts", auth,async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const query = { $expr: {
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

    
  
    if (req.query.startDate && req.query.endDate) {
      query.timestamp = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

 
    //const isAdmin= req.user.role==="admin"
    
   const [total, orders] = await Promise.all([
           PurchaseOrder.countDocuments(query),
           PurchaseOrder.find(query).populate("staff", "-password -__v -role -canApprove -_id")
           .populate("PendingApprovals.Reviewer")
           .populate("EditedBy")
             .sort({ createdAt: -1 })
             .skip(skip)
             .limit(limit)
             
             
         ]);
   
  /*const filteredOrders = orders.filter((order) => {
  const status = order.status?.trim().toLowerCase();
  return ["approved", "completed"].includes(status);
  });*/
    const response=(orders.map((order=>{
      const plainOrder=order.toObject()
     
      return plainOrder
    })))
    

    res.json({data:response,
      Pagination:getPagingData(total,page,limit)});
  } catch (error) {
    console.error(error)
    //res.status(500).json({ message: "Server error", error });
  }
});
  router.get("/all", auth,monitorLogger,async (req, res) => {
    try {
    

      
      
      const global=[ "procurement_officer","human_resources","internal_auditor","global_admin"]
      //const isAdmin= req.user.role==="admin"
      const orders=await PurchaseOrder.find().populate("staff",  "-password -__v -role -canApprove -_id")
      .populate("PendingApprovals").populate("EditedBy")
        
      const response=(orders.map((order=>{
        const plainOrder=order.toObject()
        if(!global.includes(req.user.role)){
          delete  plainOrder.Approvals
        }
        return plainOrder
      })))

      console.log("responsse",response)
      res.status(200).json({data:response});
    } catch (error) {
      console.error(error)
      //res.status(500).json({ message: "Server error", error });
    }
  });
// Get all purchase orders
router.get("/", auth,monitorLogger,async (req, res) => {
  try {
    const {role}=req.query
    const { page, limit, skip } = getPagination(req);
    const query = {};
  
   
   
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
    }else{

      queryWithApprovals = {
        ...query,
        $or:[
          {"staff":req.user.userId},
          {"status":{$in:["Completed","Approved",'Rejected']}},
          {
            PendingApprovals: { 
              $not: { $elemMatch: { Level: 1 } }
            }
          }
          
        ]
      };
    }
    const [total, orders] = await Promise.all([
      PurchaseOrder.countDocuments(queryWithApprovals),
      PurchaseOrder.find(queryWithApprovals)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("staff", "-password -__v  -canApprove -_id")
      .populate("PendingApprovals.Reviewer")
      .populate("EditedBy")
    ]);


    const response = orders
    .map(order => order.toObject())
  
   
  
    
    res.status(200).json({data:response,
      Pagination:getPagingData(total,page,limit)});
  } catch (error) {
    console.error(error)
    //res.status(500).json({ message: "Server error", error });
  }
});


router.get('/department', auth, async (req, res) => {
  try {
    const { Department } = req.query;
    const { page, limit, skip } = getPagination(req);
    let total;
    let paginatedOrders;
    let query={
      $or:[
        {"staff":req.user.userId},
        {"status":{$in:["Completed","Approved","Rejected"]}},
        {"PendingApprovals.Level": {$in:[1]}}
        
      ]
    }
    const Managers=["Waste Management Manager","Contracts_manager",
    "Financial_manager","Environmental_lab_manager","Facility Manager"]
    const subordinates=["Facility Manager","Waste Management Supervisor","lab_supervisor"]
    const allOrders = await PurchaseOrder.find(query)
      .populate("staff", "Department email name  role").populate("products","name quantity price")
      .populate("PendingApprovals.Reviewer")
      .populate("EditedBy")
      .sort({ createdAt: -1 });
    

    // Filter by Department (after population)
    
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

    // Paginate filtered orders manually

  

    const response = paginatedOrders.map(order => {
      const plainOrder = order.toObject();
      /*if (!globalRoles.includes(req.user.role)) {
        delete plainOrder.Approvals;
      }*/
      return plainOrder;
    });

    res.json({
      data: response,
      Pagination: getPagingData(total, page, limit)
    });
  } catch (error) {
    console.error("Error fetching department orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});



//if user not admin order.Approvals is removed from document
router.get("/:id", auth,async (req, res) => {
  try {
      const { id } = req.params;
       const { page, limit, skip } = getPagination(req);
      //const isAdmin= req.user.role==="admin"

      const global=[ "procurement_officer","human_resources","internal_auditor","global_admin","admin"]
    if (!id) {
      return res.status(400).json({ error: "Email is required" });
    }
    

    // Fetch user orders
   const [total, userorders] = await Promise.all([
           PurchaseOrder.countDocuments({staff:id}),
           PurchaseOrder.find({staff:id})
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate("staff", "-password -__v  -canApprove -_id")
          .populate("PendingApprovals.Reviewer")
          .populate("EditedBy")
    ]);
   
    const response=(userorders.map((order=>{
      const plainOrder = order.toObject();
      /*if(!global.includes(req.user.role)){
        delete  plainOrder.Approvals
      }*/
      return plainOrder
    })))

    if (!userorders.length) {
      return res.status(404).json({ message: "No orders found for this user" });
    }

   res.json({
      data: response,
      Pagination: getPagingData(total, page, limit)
    });
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({ error: "Failed to retrieve orders" });
  }
});
//fetch department orders

//route is just to display
router.get('/department/all', auth,async (req, res) => {
  try {
    const {Department}=req.query
    //const { page, limit, skip } = getPagination(req);

    // Fetch orders for the department
    const orders = await PurchaseOrder.find()
    .populate("staff", "Department")
    .populate("PendingApprovals")
    .populate("EditedBy")
        .sort({ createdAt: -1 })
              
  
    const filteredOrders = orders.filter(order => 
     {if (!order.targetDepartment){

        return order.staff?.Department === Department
      }
      return order.targetDepartment===Department}
    );


    
    

    res.json({data:filteredOrders,
  });
  } catch (error) {
    console.error("Error fetching department orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});




// Create a new purchase Request
router.post("/", auth, async (req, res) => {
  try {
    const { supplier, orderedBy, products,email,filenames,
       urgency,remarks,Title,staff,role,targetDepartment } = req.body;
    
   

    // Ensure products is an array and destructure its fields
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Products must be an array" });
    }

   
    const User=await user.findOne({email})
    if (!User) {
      return res.status(404).json({ error: "User not found" });
    }
    const Department=User.Department

    const newOrder = new PurchaseOrder({
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
    });
    
    
    const new_Request=await newOrder.save();
    //const PopulatedNewRequest=new_Request.populate("staff")
  
    //IncomingRequest(new_Request._id)
    ValidatePendingApprovals(new_Request._id)
    
    const exportgoogledrive=await exportToExcelAndUpload(newOrder._id);  

    res.status(200).json({success:true, newOrder });
  } catch (error) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({success:false, message: "Error creating purchase order", error });
  };
});

router.post("/export", async (req, res) => {
  try {
    const { startDate, endDate, status, filename } = req.body;

    // Input validation
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

    const query = {
      createdAt: {
        $gte: start,
        $lte: end
      }
    };

    if (status && status !== "All") {
      query.status = status;
    }

    const request_items = await PurchaseOrder.find(query)
      .populate("staff", "name Department email")
      .lean();
    if (filename && typeof filename==="string"){

      const sanitizedFileName = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
      const timestamp = Date.now();
      
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${sanitizedFileName}-${timestamp}.xlsx`);
    }

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
    request_items.forEach((item) => {
      
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

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error exporting orders:", error);
    res.status(500).json({ message: "Server error during export" });
  }
});

router.post("/memo",async(req,res)=>{

  try {
    const { requestId } = req.body;
   

    const request = await PurchaseOrder.findById(requestId)
      .populate("staff", "name Department email")
      .populate("Approvals.signature")
      .lean();

    if (!request) return res.status(404).json({ message: 'Request not found' });
    const imagePath = path.join(__dirname, "assets", "haldenlogo_1.png");
    // Create Word Document
    const doc = new Document({
  sections: [
    {
      properties: {
        page: {
          margin: {
            top: 1440,    // 1 inch
            right: 1440,
            bottom: 1440,
            left: 1440,
          }
        }
      },
      children: [
        // Company Header with Logo
        new Paragraph({
          children: [
            new ImageRun({
              
              data: fs.readFileSync(imagePath),
              transformation: {
                width: 50,
                height: 50,
              },
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        

        // Company Name and Address
       
          /*text: "HALDEN NIGERIA LIMITED",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          style: "header",
          spacing: { after: 200 }*/
        }),
        

        // Memo Title
        new Paragraph({
          text: "INTERNAL MEMORANDUM",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          border: {
            bottom: {
              color: "000000",
              space: 20,
              style: BorderStyle.SINGLE,
              size: 8
            }
          },
          spacing: { after: 600 }
        }),

        // Memo Metadata Table
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE },
            bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE },
            right: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "TO:", bold: true })],
                  width: { size: 15, type: WidthType.PERCENTAGE }
                }),
                new TableCell({
                  children: [new Paragraph({ text: "MANAGEMENT" })],
                  width: { size: 85, type: WidthType.PERCENTAGE }
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "FROM:", bold: true })]
                }),
                new TableCell({
                  children: [new Paragraph({ text: `${request.staff?.name} (${request.staff?.Department})` })],
                  width: { size: 85, type: WidthType.PERCENTAGE }
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "DATE:", bold: true })]
                }),
                new TableCell({
                  children: [new Paragraph({ text: new Date(request.createdAt).toLocaleDateString('en-NG', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  }) })]
                })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "SUBJECT:", bold: true })]
                }),
                new TableCell({
                  children: [new Paragraph({ 
                    text: `Purchase Request - ${request.Title}`,
                    color: "0000FF" // Blue color for subject
                  })]
                })
              ]
            })
          ],
          spacing: { after: 1500,
            line:500
            
           }
        }),
        new Paragraph({
          text: "",
          spacing: { after: 400 }  // Adds another 0.28 inches
        }),

        // Memo Body
        new Paragraph({
          text: "REQUEST DETAILS",
          heading: HeadingLevel.HEADING_2,
          border: {
            bottom: {
              color: "000000",
              space: 20,
              style: BorderStyle.SINGLE,
              size: 4
            }
          },
          spacing: { 
            before:200,
            after: 800,
            line:300
           }
        }),

        // Urgency and Remarks
        new Paragraph({
          text: `Urgency Level: ${request.urgency}`,
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: `Remarks: ${request.remarks || 'Not specified'}`,
          bullet: { level: 0 },
          spacing: { after: 400 }
        }),

        // Products Table
        new Paragraph({
          text: "Requested Items:",
          bold: true,
          spacing: { after: 200 }
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: TableBorders.ALL,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: "Item", bold: true })],
                  shading: { fill: "F2F2F2" }
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Quantity", bold: true })],
                  shading: { fill: "F2F2F2" }
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Unit Price (₦)", bold: true })],
                  shading: { fill: "F2F2F2" }
                }),
                new TableCell({
                  children: [new Paragraph({ text: "Total (₦)", bold: true })],
                  shading: { fill: "F2F2F2" }
                })
              ]
            }),
            ...request.products?.map(p => new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: p?.name })] }),
                new TableCell({ children: [new Paragraph({ text: p?.quantity.toString() })] }),
                new TableCell({ children: [new Paragraph({ text: `₦${p?.price.toLocaleString()}` })] }),
                new TableCell({ children: [new Paragraph({ 
                  text: `₦${(p?.quantity * p?.price).toLocaleString()}` 
                })] })
              ]
            }))
          ],
          spacing: { after: 600 }
        }),

        // Status and Footer
        new Paragraph({
          text: `Current Status: ${request.status.toUpperCase()}`,
          bold: true,
          color: request.status === "Approved" ? "008000" : 
                request.status === "Rejected" ? "FF0000" : "000000",
          spacing: { after: 1500 }
        }),
       new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TableBorders.ALL,
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph({ text: "Reviewer", bold: true })],
                    shading: { fill: "F2F2F2" }
                  }),
                  new TableCell({
                    children: [new Paragraph({ text: "Status(verified)", bold: true })],
                    shading: { fill: "F2F2F2" }
                  }),
                  new TableCell({
                    children: [new Paragraph({ text: "Signature", bold: true })],
                    shading: { fill: "F2F2F2" }
                  }),
                  new TableCell({
                    children: [new Paragraph({ text: "Time/Date", bold: true })],
                    shading: { fill: "F2F2F2" }
                  })
                ]
              }),
              ...request.Approvals?.map(Admin => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: Admin?.admin })] }),
                  new TableCell({ children: [new Paragraph({ text: Admin?.status.toString() })] }),
          
                  // ✅ If signature is an image
                  new TableCell({
                    children: Admin?.signature?.SignatureData
                      ? [new Paragraph({
                          children: [
                            new ImageRun({
                              data: Buffer.from(Admin.signature.SignatureData.split(",")[1], "base64"),
                              transformation: { width: 80, height: 30 }
                            })
                          ]
                        })]
                      : [new Paragraph({ })]
                  }),
          
                  // Time/Date
                  new TableCell({
                    children: [new Paragraph({ text: new Date(Admin.timestamp).toLocaleString() })]
                  })
                ]
              }))
            ],
            spacing: { after: 600 }
          }),

        
       

        // Confidential Footer
        new Paragraph({
          text: "CONFIDENTIAL - This document is intended solely for the use of the individual or entity to which it is addressed",
          alignment: AlignmentType.CENTER,
          
          size: 18,
          color: "808080",
          border: {
            top: {
              color: "000000",
              space: 10,
              style: BorderStyle.SINGLE,
              size: 2
            }
          }
        })
      ]
    }
  ],
  styles: {
    paragraphStyles: [
      {
        id: "header",
        name: "Header",
        run: {
          size: 32,
          bold: true,
          color: "002060" // Halden brand blue
        },
        paragraph: {
          spacing: { line: 200 }
        }
      }
    ]
  }
});

    const buffer = await Packer.toBuffer(doc);

    const filename = `memo-${request.orderNumber}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    res.send(buffer);
  } catch (error) {
    console.error("Memo generation error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/existingorder/:id",auth,RequestController.UpdateExistingRequest)

router.put("/:id/approve", auth, async (req, res) => {
  const { id: orderId } = req.params;
  const { adminName ,comment,SignatureData} = req.body;
  const user = req.user;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const parser = new UAParser(req.headers["user-agent"]);
  const deviceInfo = parser.getResult();
 
  if (!user.canApprove) {
    return res.status(403).json({ message: 'You are not authorized to approve requests' });
  }

  try {
    const order = await PurchaseOrder.findById(orderId)
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const device=deviceInfo.device


    // Remove any previous decisions from this admin
    order.Approvals = (order.Approvals || []).filter(
      a => a.admin !== adminName
    );
    const approvingUser = await users_.findOne({ name: adminName });
    if (!approvingUser) {
      return res.status(404).json({ message: "Approving user not found" });
    }
    const pendingApprovalsids=order.PendingApprovals.map((user)=>{return user.Reviewer.toString()})

    if (!pendingApprovalsids.includes(user.userId.toString())){
      return res.status(403).json({ message: 'You are not authorized to approve this  requests' });
    }
    let SavedSignature
   
    // Add new approval
    const newApproval = {
      admin: adminName,
      status: "Approved",
      comment:comment,
      timestamp: new Date()
    };
    
    if(SignatureData){
      
      SavedSignature= await CreateSignature(user.userId,SignatureData,ip,device)
      newApproval.signature=SavedSignature
    }
    order.Approvals.push(newApproval);

    
   
    if (order.PendingApprovals && order.PendingApprovals.length > 0) {
      order.PendingApprovals = order.PendingApprovals.filter(
        user => user.Reviewer.toString() !== approvingUser._id.toString()
      );
    }
    

    const prev_Request=await order.save();
    if(prev_Request.Approvals.length>3){
      ApprovedRequests(prev_Request._id)
    }
    //RequestActivity(prev_Request._id)
    
    return res.status(200).json({ 
      message: "Approval recorded successfully", 
     
    });

  } catch (error) {
    console.error("Error approving order:", error);
    return res.status(500).json({ message: "Error processing approval"});
  }
});
router.put("/:id/funding", auth, async (req, res) => {
  const { id: orderId } = req.params;
  const { adminName ,comment} = req.body;
  const user = req.user;

  if (!user.canApprove) {
    return res.status(403).json({ message: 'You are not authorized to review requests' });
  }

  try {
    const order = await PurchaseOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Remove any previous decisions from this admin
    order.Approvals = (order.Approvals || []).filter(
      a => a.admin !== adminName
    );
    

    // Add new approval
    const newApproval = {
      admin: adminName,
      status: "Awaiting Funding",
      comment:comment,
      timestamp: new Date()
    };
    order.Approvals.push(newApproval);

    
    
    
    const prev_Request=await order.save();
    //RequestActivity(prev_Request._id)
    return res.status(200).json({ 
      message: "Awaiting Funding recorded successfully", 
     
    });

  } catch (error) {
    console.error("Error Updating order:", error);
    return res.status(500).json({ message: "Error processing approval"});
  }
});

router.put("/:id/reject", auth,twoFactorVerify, async (req, res) => {
  const { id: orderId } = req.params;
  const { adminName, comment } = req.body;
  const user = req.user;

  if (!user.canApprove) {
    return res.status(403).json({ message: 'You are not authorized to reject requests' });
  }

  try {
    const SecondLevel = ["human_resources", "internal_auditor"];
    const Managers = ["Waste Management Manager", "Contracts_manager", "Financial_manager", "Environmental_lab_manager","Facility Manager","procurement_officer"];
    const MD_id = "6830789898ef43e5803ea02c";
    const order = await PurchaseOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
 
    
    
    order.Approvals = (order.Approvals || []).filter(
      a => a.admin !== adminName
    );
    const approvingUser = await users_.findOne({ name: adminName });
    if (!approvingUser) {
      return res.status(404).json({ message: "Approving user not found" });
    }

    const pendingApprovalsids=order.PendingApprovals.map((user)=>{return user.Reviewer.toString()})

    if (!pendingApprovalsids.includes(user.userId.toString())){
      return res.status(403).json({ message: 'You are not authorized to Reject this  requests' });
    }

    // Add new rejection (keeping any previous decisions)
    order.Approvals.push({
      admin: adminName,
      status: "Rejected",
      comment:comment,
      timestamp: new Date()
    });
  

    const prev_Request=await order.save();
    RequestActivity(prev_Request._id)
    return res.status(200).json({ 
      message: "Rejection recorded successfully", 
     
    });

  } catch (error) {
    console.error("Error rejecting order:", error);
    res.status(500).json({ message: "Error processing rejection"});
  }
});
router.put("/:id/MoreInfo",auth,RequestController.MoreInformation)
router.put("/:id/staffResponse",auth,RequestController.StaffResponse)
router.put("/:id/completed",auth,async(req,res)=>{
  try{
    const { id: orderId } = req.params;

    const user=req.user;

    if (!user.canApprove){
      return res.status(403).json({message:"you are not authorized"})

    }
     const order = await PurchaseOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    order.status="Completed"
    const prev_Request=await order.save()
    RequestActivity(prev_Request._id)
    res.status(200).json({message:"request completed"})



  }catch(error){
    console.error("Error completing order:", error);
    res.status(500).json({ message: "Error processing completion", error });
  


  }
})
// Update order status
router.put("/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["Pending", "Completed", "Rejected","Approved","More Information","Awaiting Funding"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const updatedOrder = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json(updatedOrder);
  } catch (error) {
    res.status(400).json({ message: "Error updating order", error });
  }
});

// Delete an order
router.delete("/:id", async (req, res) => {
  try {
    const deletedOrder = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!deletedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting order", error });
  }
});

// Delete all orders
router.delete("/", async (req, res) => {
  try {
    await PurchaseOrder.deleteMany({});
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting all orders", error });
  }
});

module.exports = router;