const auth = require("../../middlewares/check-auth");
const express=require("express")
const user_=require("../../models/users_")


const router=express.Router()
router.get("/", auth, async (req, res) => {
  try{

    return res.status(200).json({
      authenticated: true,
      message: "You have access to this protected route",
      user: {...req.user}
    });
  }catch(error){
    console.error("access route",error)
    return res.status(500).json({message:"Server Error"})
  }
});

module.exports=router