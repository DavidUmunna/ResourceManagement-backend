
// Core modules
const path = require("path");
const csrf=require("csurf")
// Third-party packages
const fs=require("fs")
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet=require("helmet")
// Custom modules
const connectDB = require("./db");
const cspmiddleware=require("./middlewares/csp")
// Route imports
const uploadRoutes = require("./routes/v1/fileupload");
const skiptrackRoutes=require("./routes/v1/skips_route")
const departmentRoutes = require("./routes/v1/Department_route");
const companyDataRoutes = require("./routes/v1/CompanyDataRoute");
const supplierRoutes = require("./routes/v1/suppliers");
const productRoutes = require("./routes/v1/products");
const orderRoutes = require("./routes/v1/orders");
const userRoutes = require("./routes/v1/users");
const signinRoutes = require("./routes/v1/signin");
const adminUserRoutes = require("./routes/v1/admin_user");
const accessRoutes = require("./routes/v1/access");
const adminTestRoutes = require("./routes/v1/admin_test");
const taskRoutes = require("./routes/v1/task");
const assetsRoutes = require("./routes/v1/assets_route");
const InventoryRoute=require("./routes/v1/Inventoy_route")
const activityroute=require("./routes/v1/activityroute")
const testDBRoute = require("./routes/v1/test-db");
const inventorylogs=require("./routes/v1/inventorylogs_route")
const roles_departments=require("./routes/v1/roles&departments")
const monitoring=require("./routes/v1/Monitoring_route")
const Scheduling=require("./routes/v1/SchedulingRoutes")
const Otp=require("./routes/v1/OTP_route")
const PaymentDetails=require("./routes/v1/PaymentRoute")
// Initialize Express
const app = express();


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
const csrfProtection=csrf({cookie:true})

// CORS setup
app.use(
  cors({
    origin: [
  "http://localhost:3000",
  "http://127.0.0.1:5000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://localhost:5000",
  "http://192.168.137.108:3000",
  "http://192.168.137.108:5000",
  "https://erp.haldengroup.ng"
  ],
    credentials: true,
  })
);
app.use(testDBRoute);
app.use(cspmiddleware)


// Static file serving
app.use("/uploads", express.static(path.join("uploads")));

// Connect to database
connectDB();

// Route usage
app.use("/api/supplier", supplierRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/users", userRoutes);
app.use("/api/signin", signinRoutes);
app.use("/api/fileupload", uploadRoutes);
app.use("/api/admin-user", adminUserRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/admin_test", adminTestRoutes);
app.use("/api/department", departmentRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/assets", assetsRoutes);
app.use("/api/companydata", companyDataRoutes);
app.use("/api/inventory", InventoryRoute);
app.use("/api/inventory/activities", activityroute);
app.use("/api/skiptrack", skiptrackRoutes);
app.use("/api/inventorylogs",inventorylogs)
app.use("/api/roles&departments",roles_departments)
app.use("/api/monitoring",monitoring)
app.use("/api/scheduling",Scheduling)
app.use("/api/otp",Otp)
app.use("/api/paymentdetails",PaymentDetails)


app.use((req, res, next) => {
  const csrfExcludedPaths = [
    "/api/admin-user/login",
    "/api/fileupload",
    "/api/companydata",
    "/api/orders/memo",
    "/api/disbursement-schedules/:id/submit",
    "/api/scheduling/disbursement-schedules/:id",
    "/api/otp/"
    
  ];

  const isUnsafeMethod = ["POST", "PUT", "DELETE"].includes(req.method);
  const isExcludedPath = csrfExcludedPaths.includes(req.path);


  if (isUnsafeMethod && !isExcludedPath) {
    try {
    return csrfProtection(req, res, next);
  } catch (err) {
    console.error('CSRF check failed:', err.message);
    return res.status(403).json({ error: 'Forbidden - CSRF validation failed' });
  }
  }
  next();
})

app.get("/api/csrf-token", csrfProtection, (req, res) => {
  res.cookie("XSRF-TOKEN", req.csrfToken());
 
  res.status(200).json({ message: "CSRF token set" });
});
// Health check route
app.get("/", (req, res) => {
  try {
    console.log("✅ Server is running and ready to accept requests!");
    res.status(200).send("Welcome to the Procurement API!");
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).send("Server error");
  }
});

app.post('/csp-report',async(req,res)=>{
  try{
    const report=JSON.stringify(req.body,null,2);
    const logfile=path.join(__dirname,"cspreports.txt")

    fs.appendFile(logfile,report,'\n\n',(err)=>{
      if(err) console.error('error writing csp-report',err)
    })
  res.status(204).end()
  }catch(error){
    console.log("csp error",error)
  }
})

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);


module.exports=app