const { Router } = require("express");
const mongoose = require("mongoose");
const PurchaseOrder = require("../../models/PurchaseOrder");
const users=require("../../models/users_")
const bcrypt=require("bcrypt")
const signin=require("../../models/sign_in")
const jwt=require("jsonwebtoken");
const sign_in = require("../../models/sign_in");
require("dotenv").config({ path: __dirname + "/.env" });
const cookieparser=require('cookie-parser')
const logging=require("./logging")



const router = Router();

router.use(cookieparser())
const authenticateToken = (req, res, next) => {
    const token = req.cookies.authToken; 

    if (!token) return res.status(401).json({ error: "Access Denied" });

    jwt.verify(token, process.env.JWT_SECRET , (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });

        req.user = user; // Attach user data to request
        next();
    });
};

router.get('/',authenticateToken,async(req,res)=>{
    try{
        const token = req.cookies.authToken;
        const user = users.find(u => u.id === req.user.id); // Fetch user from DB
        if (!user) return res.status(404).json({ error: "User not found" });
        console.log(user)
        res.json(user);

    }catch(err){
        console.error("error fetching user:",err)
    }
  
})
router.post('/',logging, async (req, res) => {
    try {
        const { username, password } = req.body;
        const email = username; 

        // Find user once (avoiding redundant queries)
        // password is select:false on the model, so ask for it explicitly
        const user_data = await users.findOne({ email }).select('+password');

        // If user doesn't exist, return error
        if (!user_data) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        // Compare the typed password with THIS user's hash. The old check,
        // users.exists({ password }), matched any user's stored hash, so anyone
        // holding a hash could log in as any email.
        const isMatch = typeof password === 'string' && await bcrypt.compare(password, user_data.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

      
        

        // Store login session
        const token = jwt.sign(
            { id: user_data._id, email: user_data.email, role: user_data.role,name:user_data.name}, 
            process.env.JWT_SECRET , 
            { expiresIn: "1h" }
        );
    
        //console.log(res.headersSent)
        res.cookie("authToken",token,{
            httpOnly: true,
            secure: false,
            maxAge: (60 * 60 * 1000)*2, // 1 hour
            sameSite: "Lax",
        },
        
        )

        return res.json({
            success:true, 
            message: "Login successful",
            token:token,
            user:{name: user_data.name,
            email: user_data.email,
            role: user_data.role,
            userId:user_data._id
        },
            
            
         });
        
        // Return user data
       
        

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});
router.post('/logout', async (req, res) => {
  const { userId, deviceId } = req.body;
  await redisClient.del(`session:${userId}:${deviceId}`);
  res.json({ message: "Logged out from this device" });
});




router.delete("/", async (req, res) => {
  try {
    await signin.deleteMany({});
    res.json({ message: "All signed out deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting all orders", error });
  }
});


module.exports=router