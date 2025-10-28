const { Router } = require('express');
const bcrypt = require('bcrypt');
const AdminUser = require('../../models/users_');
const admin_middle=require('./admin_test')
const {v4:uuidv4}=require("uuid")
const { rateLimit } = require('express-rate-limit');
const redis = require('redis');
const redisClient = redis.createClient({
  socket: {
    host: "127.0.0.1", // or "localhost"
    port: 6379
  }
});

redisClient.connect().catch(console.error); 
var loginRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  limit: 100, 
  keyGenerator: (req) => {
    // use the email or username from request body
    return req.body.username || req.ip;
  },
});
const router = Router();



// Login route

router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}$/.test(username)){
      return res.status(400).json({message:"the username entered is Not Valid"})
      
    }
    const user_data = await AdminUser.findOne({ email: username }).lean();

    if (!user_data || !(await bcrypt.compare(password, user_data.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const sessionId = uuidv4(); // create a unique session ID

    await redisClient.set(
      `session:${sessionId}`,
      JSON.stringify({
        userId: user_data._id,
        role: user_data.role,
        email: user_data.email,
        name: user_data.name,
        canApprove: user_data.canApprove,
        Department: user_data.Department,
        createdAt:user_data.createdAt
      }),
      'EX',
      1200 // 15 minutes TTL
    );
    console.log("session  Id",sessionId)
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 20 * 60 * 1000, // 15 minutes
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      secure: process.env.NODE_ENV === "production"
    });

    res.json({ success: true,
       message: "Login successful",
       user:{
        userId: user_data._id,
        role: user_data.role,
        email: user_data.email,
        name: user_data.name,
        canApprove: user_data.canApprove,
        Department: user_data.Department,
        createdAt:user_data.createdAt
       } });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.post('/logout', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!/^[0-9A-Fa-f]{24}$/.test(userId)){        //userId verification
           return res.status(400).json({message:"userId is not valid "})

    }
    const adminuser=await AdminUser.findById(userId)

    if(!adminuser){
      return res.status(404).json({success:false,message:"user Id not found"})
    }

    // Delete the Redis session
    const ExistingSession=await redisClient.del(`session:${userId}`);

    if (!ExistingSession){
      return res.status(404).json({message:"No session with matching ID"})
    }
    console.log("User logged out:", userId);
    


    // Clear the sessionId cookie
    res.clearCookie("sessionId", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out and session cleared",
    });

  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error detected",
    });
  }
});



module.exports = router;