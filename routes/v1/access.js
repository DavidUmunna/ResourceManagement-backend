const auth = require("../../middlewares/check-auth");
const express=require("express")
const user_=require("../../models/users_")
const { isHeadOfAnyDepartment } = require("../../services/departmentAccess")


const router=express.Router()
router.get("/", auth, async (req, res) => {
  try{

    // isHeadOfDepartment lets the frontend open the department page to heads
    // who don't hold an admin role. The department routes re-check this server-side.
    const isHeadOfDepartment = await isHeadOfAnyDepartment(req.user?.userId);
    return res.status(200).json({
      authenticated: true,
      message: "You have access to this protected route",
      user: {...req.user, isHeadOfDepartment}
    });
  }catch(error){
    console.error("access route",error)
    return res.status(500).json({message:"Server Error"})
  }
});

module.exports=router