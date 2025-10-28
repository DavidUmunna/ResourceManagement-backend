const inventorylogs=require("../../models/inventory_logs");
const inventory_logs = require('../../models/inventory_logs');
const express=require("express")
const {getPagination,getPagingData}=require("../../Global_Functions/pagination")
const ExcelJS=require("exceljs")
const auth = require('../../middlewares/check-auth');
const router=express.Router()
const csrf=require("csurf")
const csrfProtection=csrf({cookie:true})

router.get('/categories', auth, async (req, res) => {
    try {
      // Return your predefined categories
      const categories=[{ _id:1,name:'procurement_items'},{ _id:2,name:'lab_items'},{ _id:3,name:'HSE_materials'},{_id:4,name:'Office_items'}]
      
      res.json({ 
        success: true, 
        data: {categories}
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
});
router.post('/create',csrfProtection, async(req,res)=>{
  try{

    const {Staff_Name, quantity, inventory_item, purpose,status,category,Department}=req.body

    const new_log=new inventorylogs({
      Staff_Name,
      quantity,
      inventory_item,
      purpose,
      status,
      category,
      Department
    })
  

    await new_log.save()

    res.status(200).json({success:true,message:"log created successfully"})
  }catch(error){
    console.error(error)
    res.status(500).json({success:false,message:"log creation unsuccessfully"})
  }
})

router.get("/",async(req,res)=>{
  try{
        const {page,skip,limit}=getPagination(req)
        
        const filter={}
        
          
  
      const [total,items] = await Promise.all([
        inventorylogs.countDocuments(filter),
        inventorylogs.find(filter)
        .sort({ lastUpdated: -1 })
        .lean()
        .skip(skip)
        .limit(limit)
    
    ]);
      if(!items){
        res.status(404).json({success:false,message:"no  items available"})
      }
  
        res.json({ success: true, data: items,Pagination:getPagingData(total,page,limit) });
    } catch (err) {
      console.error("from inventory get:",err)
      res.status(500).json({ success: false, message: 'Server Error' });
    }
  
})

router.put("/:id",csrfProtection,async(req,res)=>{
   try{
    const id=req.params.id
    const {Staff_Name, quantity, inventory_item,purpose ,status,category,Department}=req.body

    const inventory_log_item=await inventory_logs.findById(id)
    if (Staff_Name){
      inventory_log_item.Staff_Name=Staff_Name
    }
    if(quantity){
      inventory_log_item.quantity=quantity
    }
    if(inventory_item){

      inventory_log_item.inventory_item=inventory_item
    }else if(status){
      inventory_log_item.status=status
    }else if(purpose){
      inventory_log_item.purpose=purpose
    }
    if (category){
      inventory_log_item.category=category
    }
    if(Department){
      
      inventory_log_item.Department=Department
    }

    await inventory_log_item.save()
    res.status(200).json({success:true, message:"update was successful"})

   }catch(error){
      console.error("error originated from inventory route PUT",error)
      res.status(500).json({success:false, message:"update was unsuccessful"})
   }
})

router.delete("/:id",csrfProtection,async(req,res)=>{
    try{
        const DeletedInventoryLog=await inventorylogs.findByIdAndDelete(req.params.id)
        
        if (!DeletedInventoryLog) {
              return res.status(404).json({ message: "Order not found" });
            }
        res.status(200).json({success:true,message:"delete was successful"})
    }catch(error){
        console.error("error from delete end:",error)
        res.status(500).json({success:false,message:"server error"})
    }


})

router.get('/:Department', auth, async (req, res) => {
    try {
        const {page,limit,skip}=getPagination(req);
        const {Department}=req.params
        const filter={}

        if (Department==="HSE_dep"){
            filter.category="HSE_materials"
        }else if(Department==="Environmental_lab_dep"){
            filter.category="lab_items"
        }else if(Department==="Administration"){
            filter.category="Office_items"
        }
       


        
      
  
      const [total,items] = await Promise.all([
        inventory_logs.countDocuments(filter),
        inventory_logs.find(filter)
        .sort({ lastUpdated: -1 })
        .lean()
        .skip(skip)
        .limit(limit)
    
    ]);
      if(!items){
        res.status(404).json({success:false,message:"no  items available"})
      }
  
        res.json({ success: true, data: items,Pagination:getPagingData(total,page,limit) });
    } catch (err) {
      console.error("from inventory get:",err)
      res.status(500).json({ success: false, message: 'Server Error' });
    }
});


router.post("/export", async(req,res)=>{
    try{
        const {startDate,endDate, status,filename, category}=req.body

        const query={
            createdAt:{
                $gte:new Date(startDate),
                $lte:new Date(endDate)
            }
        }
   
        if (status &&  status!=="All"){
            query.status=status
        }
        if (category && category!=="All"){
          query.category=category
        }

        const current_inventory_log=await inventory_logs.find(query)
        if (filename && typeof filename==="string"){

          const sanitizedFileName=filename.replace(/[^a-zA-Z0-9-_]/g,'_');
        }
        const timestamp=Date.now()
     

        res.setHeader('Cache-Control', 'no-store');

      
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', `attachment; filename=${sanitizedFileName}-${timestamp}.xlsx`)
          const workbook=new ExcelJS.Workbook()
          const worksheet=workbook.addWorksheet('Inventory logs')

          worksheet.columns=[
            {header: 'Staff Name', key:'Staff_Name',width:20},
            {header: 'Department', key:'Department',width:26},
            {header: 'Inventory Item', key:'inventory_item',width:20},
            {header: 'Quantity', key:'quantity',width:20},
            {header: 'Status', key:'status',width:20},
            {header: 'Purpose', key:'purpose',width:20},
            {header: 'Category', key:'category',width:20},
            {header: 'Date Created', key:'createdAt',width:20},
            {header: 'Date Updated', key:'updatedAt',width:20}
          ];
          current_inventory_log.forEach(entry=>{
            worksheet.addRow({
              Staff_Name:entry.Staff_Name,
              Department:entry.Department,
              inventory_item:entry.inventory_item,
              quantity:entry.quantity,
              status:entry.status,
              purpose:entry.purpose,
              category:entry.category,
              createdAt:entry.createdAt,
              updatedAt:entry.updatedAt
            })
          })
          res.status(200);
          await workbook.xlsx.write(res);
          res.end();       
    }catch(error){
        console.error('Export error:', error);
        res.status(500).json({ message: 'Error exporting skip data.' });
    }
})





module.exports=router;