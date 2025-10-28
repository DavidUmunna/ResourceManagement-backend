const express = require('express')
const router = express.Router();
const invetoryItem = require('../../models/inventory');
const auth= require('../../middlewares/check-auth');
const InventoryItem = require('../../models/inventory');
const Activity=require("../../models/Activity");
const { getPagination, getPagingData } = require('../../Global_Functions/pagination');


function generateSKU(name) {
    if (name&& typeof name !== "string") return
    const prefix = name.substring(0, 3).toUpperCase(); 
    const unique = Date.now().toString().slice(-5);    
    return `${prefix}-${unique}`;     
}  
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
        InventoryItem.countDocuments(filter),
        InventoryItem.find(filter)
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
      
      res.status(500).json({ success: false, message: 'Server Error' });
    }
});

 

router.post('/', auth, async (req, res) => {
  try {
    const { name, category, quantity, AddedBy } = req.body;
    const sku=generateSKU(name)
    const newItem = new InventoryItem({
      name,
      category,
      quantity,
      
      sku,
      AddedBy: AddedBy
    });
    await Activity.create({
        action: 'Created',
        itemId: newItem._id,
        itemName: newItem.name,
        quantity: newItem.quantity,
        category:newItem.category,
        AddedBy: req.user.name,
        userName: req.user.name
      });

    

    await newItem.save();
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
   
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: Object.values(err.errors).map(val => val.message) 
      });
    }
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

router.put("/:id",auth,async(req,res)=>{
    try{
        const { quantity } = req.body;
        const item = await InventoryItem.findById(req.params.id);
        
        if (!item) return res.status(404).json({ error: 'Item not found' });
    
        const action = quantity > 0 ? 'Added' : 'Removed';
        const absQuantity = Math.abs(quantity);
    
        // Update quantity
        item.quantity += quantity;
        if (item.quantity < 0) item.quantity = 0;
        item.lastUpdated = Date.now();
        await item.save();
    
        // Log activity
        await Activity.create({
          action,
          itemId: item._id,
          itemName: item.name,
          quantity: absQuantity,
          category:item.category,
          user: req.user._id,
          userName: req.user.name
        });
    
        res.json({ data: item });
    }catch(error){
        console.error("error originated from update quantity:",error)
        res.status(500).json({message:"server error"})

    }

})
router.delete('/:id', auth, async (req, res) => {
  try {
    const deletedItem = await InventoryItem.findByIdAndDelete(req.params.id);
    
    if (!deletedItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, message:"deleted successfully" });
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});






module.exports=router;