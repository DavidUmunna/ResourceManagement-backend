const express = require("express");
const redis = require("redis");
const cookieParser = require("cookie-parser");

const router = express.Router();

const redisClient = redis.createClient();
redisClient.connect().catch(console.error); // Redis v4+

router.use(cookieParser()); // Ensure this is added in your main app.js

router.use(async (req, res, next) => {
  try {
    const sessionId = req.cookies.sessionId
    console.log("Checking session ID:", sessionId);
    
    if (!sessionId) {
      return res.status(401).json({
        authenticated: false,
        message: "No session ID found",
      });
    }

    const sessionData = await redisClient.get(`session:${sessionId}`);

    if (!sessionData) {
      return res.status(401).json({
        authenticated: false,
        message: "Session expired or invalid",
      });
    }

    const user = JSON.parse(sessionData);
  
    // Optional: refresh TTL on every request
    await redisClient.expire(`session:${sessionId}`, 1200); // Extend 15 min TTL

    req.user = user;
     
    next();
  } catch (error) {
    console.error("Error in Redis auth middleware:", error);
    res.status(500).json({
      authenticated: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
