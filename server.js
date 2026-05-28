
// Core modules
const path = require("path");
const csrf=require("csurf")
// Third-party packages
const fs=require("fs")
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet=require("helmet")
require("./Global_Functions/checkExpiry");
// Custom modules
const connectDB = require("./db");
const cspmiddleware=require("./middlewares/csp")
const auth=require("./middlewares/check-auth")
// Route imports
const UserSchema=require('./models/users_')
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
const FileTrack=require("./routes/v2/FileTracking")
const ComplianceLog=require("./routes/v2/ComplianceLog")
const TenderRoutes = require("./routes/v1/tender")
const aiRoutes = require("./ai/ai.routes")
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./docs/swagger");
const  createFeedbackRoutes  = require('./routes/v2/feedback.routes');
const { FeedbackController } = require('./controllers/FeedbackController');
const { FeedbackService } = require('./services/FeedbackService');
const FeedbackRepository  = require('./repositories/FeedbackRepository');
const { FeedbackValidator } = require('./services/validation/FeedbackValidator');
const { EmailNotificationService } = require('./services/NotificationService');
const { errorHandler } = require('./middlewares/errorHandler');
// Initialize Express
const app = express();

// CORS must be first — before helmet and any other middleware
// so that preflight OPTIONS requests get the correct headers
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:5000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://localhost:5000",
    "http://192.168.137.108:3000",
    "http://192.168.137.108:5000",
    "https://erp.haldengroup.ng",
  ],
  credentials: true,
};
app.use(cors(corsOptions));


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
const csrfProtection=csrf({cookie:true})
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
app.use("/api/v2/filetrack",FileTrack)
app.use("/api/v2/compliance",ComplianceLog)
app.use("/api/tenders", TenderRoutes)
app.use("/api/ai", aiRoutes)


console.log('Creating repository...');
const feedbackRepository = new FeedbackRepository();

console.log('Creating validator...');
const feedbackValidator = new FeedbackValidator();

console.log('Creating notification service...');
const notificationService = new EmailNotificationService();

console.log('Creating service...');
const feedbackService = new FeedbackService(
  feedbackRepository,
  feedbackValidator,
  notificationService
);

console.log('Creating controller...');
const feedbackController = new FeedbackController(feedbackService);

// Verify controller methods
console.log('Controller methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(feedbackController)));
console.log('createFeedback exists:', typeof feedbackController.createFeedback === 'function');
console.log('getAllFeedback exists:', typeof feedbackController.getAllFeedback === 'function');


// Routes
console.log('Setting up routes...');
const feedbackRoutes = createFeedbackRoutes(feedbackController);
app.use('/api/feedback', feedbackRoutes);
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec))
app.get("/api/docs.json", (req, res) => res.json(swaggerSpec));
app.use(errorHandler);

app.use((req, res, next) => {
  const csrfExcludedPaths = [
    "/api/admin-user/login",
    "/api/fileupload",
    "/api/companydata",
    "/api/orders/memo",
    "/api/disbursement-schedules/:id/submit",
    "/api/scheduling/disbursement-schedules/:id",
    "/api/otp/",
    "api/v2/filetrack",
    "/save-token",
    "/api/tenders/upload"
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

  return res.status(200).json({ message: "CSRF token set" });
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

//Notification-token
app.post('/save-token',auth, async(req, res) => {
  try{

    const { currentToken } = req.body;
    
    const {userId}=req.user
    if (!currentToken) {
      return res.status(400).json({ error: "Token is required" });
    }
    const currentUser=await UserSchema.findById({_id:userId})
    if(!currentUser){
      return res.status(404).json({message:"there is no such user"})
    }
    currentUser.NotificationToken=currentToken
    
    await currentUser.save()
    console.log("token saved")
    
    res.status(200).json({ message: "Token saved successfully" });
  }catch(error){
    console.error("notification error",error)

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

// default response is already handled by GET "/" above

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);


module.exports=app
