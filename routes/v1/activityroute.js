const Activity = require('../../models/Activity');
const express=require('express')
const auth=require('../../middlewares/check-auth')
const { getPagination, getPagingData } = require('../../Global_Functions/pagination');
const router=express.Router()


router.get("/:Department",async(req,res)=>{
    try{
        const { page, limit, skip} = getPagination(req);
        
        const {Department}=req.params
        const filter={}

        if (Department=== "HSE_dep"){
              filter.category="HSE_materials"
        }else if(Department==="Environmental_lab_dep"){
              filter.category="lab_items"
        }else if(Department==="Administration"){
            filter.category="Office_items"
        }
     
    // Example filter by action type
    if (req.query.action) {
      query.action = req.query.action;
    }
    
    // Example date range filter
    if (req.query.startDate && req.query.endDate) {
      query.timestamp = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }
    const [total, activities] = await Promise.all([
        Activity.countDocuments(filter),
        Activity.find(filter)
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .populate('itemId', 'name category')
      ]);
        
        res.json({ data: activities,
        pagination:getPagingData(total, page, limit)
        });
    }catch(error){
        console.error("originated from activity route",error)
        res.status(500).json({ message: "Server Error" });

    }
})


router.delete("/:id",auth,async(req,res)=>{
  try{
    const {role}=req.user
    const {id}=req.params
    console.log("activity id",id)

    if(role!="global_admin"){
      return res.status(403).json({success:false,message:"you are not Authorized"})
    }

    const response=await Activity.deleteOne({_id:id})
    console.log("the deleted log",response)
    res.status(200).json({success:true,message:"Log Deleted Successfully"})
  }catch(error){
    console.error("originated from activity route",error)
        res.status(500).json({ message:"server error" });

  }

})


module.exports=router