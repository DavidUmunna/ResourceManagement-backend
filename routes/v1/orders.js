const { Router } = require("express");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/PurchaseOrder");
const AssetExpenditure = require("../../models/AssetExpenditure");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
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
const { sendPushNotification } = require("../../Global_Functions/firebasePushNotification");
const { deleteFileFromCloud } = require("../../googlecloudstorage.service");
const { deleteFileFromDrive } = require("../../googledriveservice");
const followUpController = require("../../controllers/v1.controllers/requestFollowUp.controllers");

// ── Request follow-ups (nudge a pending request without duplicating it) ──────
// Static /followups/* before the generic /:id routes.
router.get("/followups/sent", auth, followUpController.sent);          // requester dashboard
router.get("/followups/received", auth, followUpController.received);  // approver dashboard
router.get("/followups/escalated", auth, followUpController.escalatedReceived); // escalated POs I can act on
router.post("/:id/followup", auth, followUpController.create);
router.get("/:id/followups", auth, followUpController.listForOrder);

// ── PO share link (public, tokenized PDF) ────────────────────────────────────

// Render the purchase order into a pdfkit document
function renderPurchaseOrderPdf(doc, order) {
  const money = (n) => `NGN ${Number(n || 0).toLocaleString()}`;
  const staffName = order.staff?.name || order.orderedBy || "—";
  const dept = order.staff?.Department || order.Department || "—";
  const products = Array.isArray(order.products) ? order.products : [];
  const total = products.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 1), 0);

  // Header — logo and company name side by side
  const logoPath = path.join(__dirname, 'assets', 'haldenlogo_1.png');
  const headerY = doc.y;
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 40, headerY, { width: 48, height: 48 });
    doc.fontSize(20).fillColor("#1f2937").text("Halden Group", 98, headerY + 4);
    doc.fontSize(13).fillColor("#4b5563").text("Purchase Order", 98, headerY + 28);
    doc.y = headerY + 54;
  } else {
    doc.fontSize(20).fillColor("#1f2937").text("Halden Group");
    doc.fontSize(13).fillColor("#4b5563").text("Purchase Order");
  }
  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#e5e7eb").stroke();
  doc.moveDown(0.8);

  // Meta (two columns)
  // rowY adds an extra 14pt gap after "Title" (index 1) before "Requested by" (index 2)
  const startY = doc.y;
  const rowY = (i) => startY + i * 20 + (i >= 2 ? 14 : 0);
  const left = [
    ["PO Number", `#${order.orderNumber || "—"}`],
    ["Title", order.Title || "—"],
    ["Requested by", staffName],
    ["Department", dept],
  ];
  const right = [
    ["Status", order.status || "—"],
    ["Urgency", order.urgency || "—"],
    ["Supplier", order.supplier || "—"],
    ["Date", order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-GB") : "—"],
  ];
  doc.fontSize(10);
  left.forEach(([k, v], i) => {
    doc.fillColor("#6b7280").text(`${k}:`, 40, rowY(i), { continued: true, width: 250 });
    doc.fillColor("#111827").text(` ${v}`);
  });
  right.forEach(([k, v], i) => {
    doc.fillColor("#6b7280").text(`${k}:`, 310, rowY(i), { continued: true, width: 245 });
    doc.fillColor("#111827").text(` ${v}`);
  });
  doc.y = rowY(left.length) + 14;

  // Items
  doc.fontSize(12).fillColor("#111827").text("Items", 40);
  doc.moveDown(0.3);
  const t = doc.y;
  const col = { name: 40, qty: 330, price: 390, total: 480 };
  doc.fontSize(9).fillColor("#6b7280");
  doc.text("Description", col.name, t);
  doc.text("Qty", col.qty, t);
  doc.text("Unit Price", col.price, t);
  doc.text("Total", col.total, t);
  doc.moveTo(40, t + 13).lineTo(555, t + 13).strokeColor("#e5e7eb").stroke();
  let y = t + 19;
  doc.fontSize(10).fillColor("#111827");
  products.forEach((p) => {
    const qty = Number(p.quantity) || 1;
    const price = Number(p.price) || 0;
    doc.fillColor("#111827").text(p.name || "—", col.name, y, { width: 280 });
    doc.text(String(qty), col.qty, y);
    doc.text(money(price), col.price, y);
    doc.text(money(price * qty), col.total, y);
    y += 20;
  });
  doc.moveTo(40, y).lineTo(555, y).strokeColor("#e5e7eb").stroke();
  doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold")
    .text(`Grand Total: ${money(total)}`, 40, y + 8, { align: "right", width: 515 });
  doc.font("Helvetica");
  doc.y = y + 34;

  // Remarks
  if (order.remarks) {
    doc.fontSize(12).fillColor("#111827").text("Remarks", 40);
    doc.fontSize(10).fillColor("#374151").text(order.remarks, { width: 515 });
    doc.moveDown(0.6);
  }

  // Approvals (names + decision + date; no signature images)
  const approvals = Array.isArray(order.Approvals) ? order.Approvals : [];
  doc.fontSize(12).fillColor("#111827").text("Approvals", 40);
  doc.moveDown(0.3);
  if (approvals.length === 0) {
    doc.fontSize(10).fillColor("#6b7280").text("No approvals recorded yet.");
  } else {
    approvals.forEach((a) => {
      const when = a.timestamp ? new Date(a.timestamp).toLocaleDateString("en-GB") : "";
      doc.fontSize(10).fillColor("#111827").text(`${a.admin || "—"} — ${a.status || "—"}${when ? ` (${when})` : ""}`);
      if (a.comment) doc.fontSize(9).fillColor("#6b7280").text(`   ${a.comment}`, { width: 500 });
    });
  }

  doc.fontSize(8).fillColor("#9ca3af")
    .text(`Generated ${new Date().toLocaleString("en-GB")} · Shared read-only copy.`, 40, 790, { align: "center", width: 515 });
}

// Authenticated user mints a 7-day public link to the PO PDF
router.post("/:id/share-link", auth, async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const token = jwt.sign(
      { orderId: order._id.toString(), purpose: "po-share" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const base = process.env.PUBLIC_API_URL || `${proto}://${req.get("host")}`;
    return res.status(200).json({ success: true, url: `${base}/api/orders/share/${token}/pdf` });
  } catch (error) {
    console.error("Error creating PO share link:", error);
    return res.status(500).json({ message: "Failed to create share link" });
  }
});

// Public — anyone with a valid token can view the PO as a PDF (no login)
router.get("/share/:token/pdf", async (req, res) => {
  try {
    let payload;
    try {
      payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
    } catch {
      return res.status(410).send("This purchase-order link has expired or is invalid.");
    }
    if (payload.purpose !== "po-share") return res.status(400).send("Invalid link.");

    const order = await PurchaseOrder.findById(payload.orderId).populate("staff", "name email Department");
    if (!order) return res.status(404).send("Purchase order not found.");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="PO-${order.orderNumber || order._id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);
    renderPurchaseOrderPdf(doc, order);
    doc.end();
  } catch (error) {
    console.error("Error rendering PO PDF:", error);
    if (!res.headersSent) res.status(500).send("Failed to render the purchase order.");
  }
});

// ── Duplicate detection (server-side, across all visible orders) ─────────────

// Transitive grouping of similar orders via union-find.
// Two orders are "similar" if they share an identical (non-empty) product
// bundle OR their remarks are similar (Jaccard on word sets) at/above threshold.
function detectDuplicateGroups(orders, threshold) {
  const n = orders.length;
  if (n < 2) return [];

  // Precompute signatures once (avoids re-tokenising on every comparison)
  const remarkTokens = orders.map((o) => {
    const s = (o.remarks || "").toLowerCase().trim();
    return s ? new Set(s.split(/\s+/)) : null;
  });
  const productSig = orders.map((o) => {
    const prods = Array.isArray(o.products) ? o.products : [];
    if (prods.length === 0) return null; // empty product lists never match
    return prods.map((p) => `${(p.name || "").toLowerCase()}-${p.quantity}`).sort().join("|");
  });

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Fast path — identical product bundles grouped via a hash map, O(n)
  const bySig = new Map();
  for (let i = 0; i < n; i++) {
    const sig = productSig[i];
    if (!sig) continue;
    if (bySig.has(sig)) union(i, bySig.get(sig));
    else bySig.set(sig, i);
  }

  // Fuzzy remark similarity — O(n²) but cheap with precomputed token sets
  const jaccard = (a, b) => {
    if (!a || !b) return 0;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const uni = a.size + b.size - inter;
    return uni > 0 ? inter / uni : 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue; // already in the same group
      if (jaccard(remarkTokens[i], remarkTokens[j]) >= threshold) union(i, j);
    }
  }

  // Collect groups of size > 1
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(orders[i]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

router.get("/duplicates", auth, async (req, res) => {
  try {
    const threshold = Math.min(1, Math.max(0, parseFloat(req.query.threshold) || 0.7));
    // Duplicates are re-submissions — bound the scan to a recent window
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Same visibility scoping as the orders list
    const visibility = req.user.userId === "6830789898ef43e5803ea02c"
      ? { $or: [{ staff: req.user.userId }, { status: "Completed" }, { PendingApprovals: { $not: { $elemMatch: { Level: { $in: [1, 2] } } } } }] }
      : { $or: [{ staff: req.user.userId }, { status: { $in: ["Completed", "Approved", "Rejected"] } }, { PendingApprovals: { $not: { $elemMatch: { Level: 1 } } } }] };

    const orders = await PurchaseOrder.find({ ...visibility, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(1000) // hard cap to bound the O(n²) pass
      .populate("staff", "name email Department")
      .lean();

    const groups = detectDuplicateGroups(orders, threshold);
    return res.status(200).json({ data: groups, count: groups.length });
  } catch (error) {
    console.error("Error detecting duplicates:", error);
    return res.status(500).json({ message: "Failed to detect duplicates" });
  }
});

router.get("/reviewed",auth,RequestController.ReviewedRequests)
router.delete("/:id/staffresponse",auth,RequestController.DeleteStaffResponse)
router.get("/staffresponses",auth,RequestController.GetStaffResponses)
router.get('/analytics/purchase-orders', poAnalyticsController.getPOAnalytics);
router.get('/monthlyrequests',auth,GetOverallMonthlyRequests)
router.get("/StaffRequests",MonthlyStaffRequest)
// Specialized analytics endpoints
router.get('/analytics/purchase-orders/status-distribution', poAnalyticsController.getPOStatusDistribution);
router.get('/analytics/purchase-orders/urgency-stats', poAnalyticsController.getPOUrgencyStats);
router.get('/analytics/purchase-orders/by-department', auth, poAnalyticsController.getSpendByDepartment);
router.get('/analytics/purchase-orders/by-status', auth, poAnalyticsController.getSpendByStatus);
router.get('/analytics/purchase-orders/spend-summary', auth, poAnalyticsController.getSpendSummary);
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
           PurchaseOrder.find(query).populate("staff", "-password -__v -role -canApprove -NotificationToken ")
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
      const orders=await PurchaseOrder.find().populate("staff",  "-password -__v -role -canApprove -NotificationToken ").populate("products","name quantity price")
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
      .sort({ escalated: -1, escalatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("staff", "-password -__v  -canApprove -NotificationToken ")
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
      .populate("staff", "Department email name role").populate("products","name quantity price")
      .populate("PendingApprovals.Reviewer")
      .populate("EditedBy")
      .sort({ escalated: -1, escalatedAt: -1, createdAt: -1 });
    

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
          .populate("staff", "-password -__v  -canApprove -notificationToken ")
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
    .populate("staff", "Department").populate("products","name quantity price")
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
    const {
      supplier,
      orderedBy,
      products,
      email,
      filenames,
      urgency,
      remarks,
      Title,
      staff,
      role,
      targetDepartment,
      isMaintenance,
      assetCategory,
      assetSubCategory
    } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Products must be an array" });
    }

    // A maintenance request must name the asset sub-category it applies to
    if (isMaintenance && (!assetSubCategory || !assetCategory)) {
      return res.status(400).json({ error: "assetCategory and assetSubCategory are required for a maintenance request" });
    }

    const User = await user.findOne({ email });

    if (!User) {
      return res.status(404).json({ error: "User not found" });
    }

    const Department = User.Department;

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
      targetDepartment,
      isMaintenance: !!isMaintenance,
      ...(isMaintenance && { assetCategory, assetSubCategory }),
    });

    const new_Request = await newOrder.save();

    await ValidatePendingApprovals(new_Request._id);

    const usersToNotify = await user.find({
      $or: [
        { role: { $in: ["global_admin", "accounts"] } },
        { Department: targetDepartment || Department }
      ]
    }).select("NotificationToken name Department");


    const tokens = usersToNotify
      .flatMap((u) => {
        console.log("user to notify",u)
        if (Array.isArray(u.NotificationToken)) return u.NotificationToken;
        if (u.NotificationToken) return [u.NotificationToken];
        return [];
      })
      .filter(Boolean);

   await Promise.allSettled(
  tokens.map((token) =>
    sendPushNotification(
      token,
      "New request submitted",
      `${Title || "A new request"} was created by ${User.name || email}`,
      {
        type: "new_request",
        orderId: String(new_Request._id),
        department: String(targetDepartment || Department || ""),
      }
    )
  )
);

    res.status(200).json({ success: true, newOrder: new_Request });
  } catch (error) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({
      success: false,
      message: "Error creating purchase order",
      error
    });
  }
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

router.put("/:id/escalate", auth, async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.staff.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ message: "Only the requester can escalate their own order" });
    }
    if (order.escalated) {
      return res.status(400).json({ message: "Order is already escalated" });
    }
    if (order.PendingApprovals.length === 0) {
      return res.status(400).json({ message: "No pending approvers to notify" });
    }

    order.escalated = true;
    order.escalatedAt = new Date();
    await order.save();

    const approvers = await user.find({ canApprove: true }).select("NotificationToken name");
    const tokens = approvers.flatMap((u) =>
      Array.isArray(u.NotificationToken) ? u.NotificationToken : u.NotificationToken ? [u.NotificationToken] : []
    ).filter(Boolean);

    await Promise.allSettled(
      tokens.map((token) =>
        sendPushNotification(
          token,
          "Order escalated — needs attention",
          `${order.Title || order.orderNumber} has been escalated and requires your review`,
          { type: "escalated_order", orderId: String(order._id) }
        )
      )
    );

    return res.status(200).json({ success: true, escalated: true });
  } catch (error) {
    console.error("Error escalating order:", error);
    return res.status(500).json({ message: "Error processing escalation" });
  }
});

router.put("/:id/deescalate", auth, async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isOwner = order.staff.toString() === req.user.userId.toString();
    if (!isOwner && !req.user.canApprove) {
      return res.status(403).json({ message: "Only the requester or an approver can remove escalation" });
    }
    if (!order.escalated) {
      return res.status(400).json({ message: "Order is not escalated" });
    }

    order.escalated = false;
    order.escalatedAt = undefined;
    await order.save();

    return res.status(200).json({ success: true, escalated: false });
  } catch (error) {
    console.error("Error removing escalation:", error);
    return res.status(500).json({ message: "Error removing escalation" });
  }
});

// ── Payment receipt recording ───────────────────────────────────────────────

const PAYMENT_ROLES = ['Accountant', 'global_admin'];
const PAYMENT_DEPTS = ['accounts_dep', 'Accounts'];

router.post("/:id/pay/record", auth, async (req, res) => {
  try {
    const { role, Department } = req.user;
    if (!PAYMENT_ROLES.includes(role) && !PAYMENT_DEPTS.includes(Department)) {
      return res.status(403).json({ message: "Only accountants can record payments" });
    }

    const order = await PurchaseOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.status !== "Approved") {
      return res.status(400).json({ message: "Payment can only be recorded for Approved orders" });
    }
    if (order.payment?.status === "paid") {
      return res.status(400).json({ message: "This order has already been paid" });
    }

    const { reference, channel, paidAt, amount } = req.body;
    if (!reference) return res.status(400).json({ message: "Payment reference is required" });

    const totalAmount = amount || (order.products || []).reduce(
      (sum, p) => sum + (p.price || 0) * (p.quantity || 1), 0
    );

    order.payment = {
      status: 'paid',
      reference,
      amount: totalAmount,
      channel: channel || 'manual',
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      paidBy: req.user.userId,
    };
    await order.save();

    return res.status(200).json({ success: true, payment: order.payment });
  } catch (error) {
    console.error("Payment record error:", error);
    return res.status(500).json({ message: "Failed to record payment" });
  }
});

router.get("/:id/pay/receipt", auth, async (req, res) => {
  try {
    const order = await PurchaseOrder.findById(req.params.id)
      .populate("staff", "name email Department")
      .populate("payment.paidBy", "name email")
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.payment?.status !== "paid") {
      return res.status(400).json({ message: "No payment recorded for this order" });
    }

    const imagePath = path.join(__dirname, "assets", "haldenlogo_1.png");
    const { payment, products = [] } = order;
    const totalAmount = payment.amount ||
      products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 1), 0);

    const channelLabel = {
      bank_transfer: 'Bank Transfer',
      cash: 'Cash',
      cheque: 'Cheque',
      card: 'Card',
      manual: 'Manual Entry',
    }[payment.channel] || payment.channel || 'N/A';

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
          new Paragraph({
            children: [new ImageRun({
              data: fs.readFileSync(imagePath),
              transformation: { width: 60, height: 60 },
            })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: "PAYMENT RECEIPT",
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            border: { bottom: { color: "000000", space: 20, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { after: 500 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            rows: [
              ...[
                ["Receipt For:", order.Title || order.orderNumber],
                ["Order Number:", order.orderNumber],
                ["Requester:", order.staff?.name || "—"],
                ["Department:", order.staff?.Department || "—"],
                ["Payment Reference:", payment.reference],
                ["Payment Channel:", channelLabel],
                ["Amount Paid:", `₦${Number(totalAmount).toLocaleString()}`],
                ["Payment Date:", payment.paidAt ? new Date(payment.paidAt).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" }) : "—"],
                ["Recorded By:", payment.paidBy?.name || "—"],
              ].map(([label, value]) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ text: label, bold: true })], width: { size: 30, type: WidthType.PERCENTAGE } }),
                    new TableCell({ children: [new Paragraph({ text: value })], width: { size: 70, type: WidthType.PERCENTAGE } }),
                  ],
                })
              ),
            ],
            spacing: { after: 600 },
          }),
          new Paragraph({ text: "", spacing: { after: 300 } }),
          new Paragraph({
            text: "Items Purchased",
            heading: HeadingLevel.HEADING_2,
            border: { bottom: { color: "000000", space: 10, style: BorderStyle.SINGLE, size: 4 } },
            spacing: { after: 300 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TableBorders.ALL,
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: "Item", bold: true })], shading: { fill: "F2F2F2" } }),
                  new TableCell({ children: [new Paragraph({ text: "Qty", bold: true })], shading: { fill: "F2F2F2" } }),
                  new TableCell({ children: [new Paragraph({ text: "Unit Price (₦)", bold: true })], shading: { fill: "F2F2F2" } }),
                  new TableCell({ children: [new Paragraph({ text: "Total (₦)", bold: true })], shading: { fill: "F2F2F2" } }),
                ],
              }),
              ...products.map(p => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: p.name || "" })] }),
                  new TableCell({ children: [new Paragraph({ text: String(p.quantity || 0) })] }),
                  new TableCell({ children: [new Paragraph({ text: `₦${Number(p.price || 0).toLocaleString()}` })] }),
                  new TableCell({ children: [new Paragraph({ text: `₦${Number((p.price || 0) * (p.quantity || 1)).toLocaleString()}` })] }),
                ],
              })),
            ],
            spacing: { after: 600 },
          }),
          new Paragraph({ text: "", spacing: { after: 400 } }),
          new Paragraph({
            text: `TOTAL PAID: ₦${Number(totalAmount).toLocaleString()}`,
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.RIGHT,
            spacing: { after: 800 },
          }),
          new Paragraph({
            text: "This receipt serves as proof of payment for the above purchase order.",
            alignment: AlignmentType.CENTER,
            color: "808080",
            border: { top: { color: "000000", space: 10, style: BorderStyle.SINGLE, size: 2 } },
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${order.orderNumber}.docx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (error) {
    console.error("Receipt generation error:", error);
    res.status(500).json({ message: "Failed to generate receipt" });
  }
});

// ── End payment routes ──────────────────────────────────────────────────────

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

    // A maintenance order is "fully approved" once every required approver has
    // acted (no one left pending) and none of them rejected it. At that point,
    // add its total to the chosen asset sub-category's expenditure — once only.
    const noRejections = !order.Approvals.some(a => a.status === "Rejected");
    const fullyApproved = order.PendingApprovals.length === 0 && noRejections;
    if (order.isMaintenance && fullyApproved && !order.maintenanceExpenditureApplied) {
      const amount = (order.products || []).reduce(
        (sum, p) => sum + (Number(p.price) || 0) * (Number(p.quantity) || 1),
        0
      );
      if (amount > 0 && order.assetSubCategory && order.assetCategory) {
        await AssetExpenditure.findOneAndUpdate(
          { category: order.assetCategory, subCategory: order.assetSubCategory },
          {
            $inc: { totalExpenditure: amount, orderCount: 1 },
            $push: { entries: { order: order._id, amount, at: new Date() } },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        order.maintenanceExpenditureApplied = true;
      }
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

    if (deletedOrder.fileRefs) {
      const fileDoc = await file.findById(deletedOrder.fileRefs);
      if (fileDoc) {
        await Promise.allSettled(
          (fileDoc.files || []).map(async (f) => {
            try {
              if (f.gcsObjectName) {
                await deleteFileFromCloud(f.gcsObjectName);
              } else if (f.driveFileId) {
                await deleteFileFromDrive(f.driveFileId);
              }
            } catch (err) {
              console.error("Failed to delete attachment from storage:", err.message);
            }
          })
        );
        await file.findByIdAndDelete(deletedOrder.fileRefs);
      }
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