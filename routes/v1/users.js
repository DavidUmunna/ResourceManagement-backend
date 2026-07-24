const {Router}=require('express')
const User=require('../../models/users_');
const users_ = require('../../models/users_');
require('dotenv').config({ path: './.env' });
const bcrypt=require("bcrypt")
const auth=require("../../middlewares/check-auth")
const crypto=require("crypto")
const {transporter} = require('../../emailnotification/emailNotification');
const csrf=require("csurf")
const csrfProtection=csrf({cookie:true})
const router=Router()

router.get("/", async (req, res) => {
  try {
    const page       = Math.max(1, parseInt(req.query.page)  || 1);
    const limit      = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip       = (page - 1) * limit;
    const search     = req.query.search     ? req.query.search.trim()     : '';
    const department = req.query.department ? req.query.department.trim() : '';
    const role       = req.query.role       ? req.query.role.trim()       : '';

    const filter = {};
    if (department) filter.Department = department;
    if (role)       filter.role       = role;
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or  = [{ name: regex }, { email: regex }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    const data = users.map(u => { delete u.password; return u; });

    res.status(200).json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});
/*router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    console.log(email);

    const user = await User.findOne({ email });

    if (user) {
      res.status(200).json({ success: true, message: "user exists" });
    } else {
      res.status(404).json({ success: false, message: "user does not exist" });
    }
  } catch (error) {
    res.status(500).json({ message: "An error occurred while getting user" });
  }
});*/


router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Fetch user orders
    const userRequests = await users_.find({ email });

    if (!userRequests.length) {
      return res.status(404).json({ message: "No user found for this email" });
    }

    res.status(200).json(userRequests);
  } catch (error) {
    console.error("Error fetching user :", error);
    res.status(500).json({ error: "Failed to retrieve user" });
  }
});

router.get("/roles&departments",async(req,res)=>{
  try{
    const general_access= ["procurement_officer", "human_resources", "internal_auditor", "global_admin","admin",
      "Financial_manager","Accountant","Director",];

    const departmental_access=["waste_management_manager","waste_management_supervisor","PVT_manager","Environmental_lab_manager","PVT_manager","lab_supervisor"]

    const approved_access=["accounts_dep"]

    res.status(200).json({message:"response successful",general_access,departmental_access,approved_access})
  }catch(error){
    console.error("from roles&departments:",error)
    res.status(500).json({message:"server error"})
  }
})
//create the user
router.post('/', auth,async (req, res) => {
  try {
    const can_approve_roles = ["procurement_officer", "human_resources", "internal_auditor", "global_admin","waste_mnagement_manager","waste_management_supervisor",
      "PVT_manager","Environmental_lab_manager","Financial_manager","Accountant","Director","Contracts_manager"];
    const { name, email, password, Department, role } = req.body;
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}$/.test(email)){
      return res.status(403).json({message:"email does not match format"})
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const new_user = new User({
      name,
      email,
      password: hashedPassword, //assign the hashed password
      Department,
      role,
      canApprove: can_approve_roles.includes(role) // assign this directly
    });

    await new_user.save();
    res.status(201).json({success:true,message:"User creation was successful"});

  } catch (error) {
    console.error(error);
    res.status(400).json({success:false, message: "Error: User not created", error: error.message });
  }
});


router.put("/reset" ,async (req, res) => {
  try {
      const { email } = req.body;
      console.log(email) // Get email from URL params
      const user = await User.findOne({ email });

      if (user) {
        const token=crypto.randomBytes(32).toString('hex')
        user.resetToken=token;
        user.resetTokenExpiration=new Date(Date.now()+(1000*60*15))
;       console.log("resettoken:",user.resetTokenExpiration)
        await user.save()
        const FRONTEND_URL=process.env.FRONTEND_BASED_URL
        const resetLink = `${FRONTEND_URL}/reset-password?token=${token}`;
        const mailOptions = {
          from: '"Halden Resource management"<noreply@Haldengroup.ng>',
          to: user.email,
          subject: 'Password Reset Request',
          html: `
          <p>You requested a password reset.</p>
          <p>Click this link to reset your password: <a href="${resetLink}">${resetLink}</a></p>
          <p>This link will expire in 15 minutes.</p>
          `,
        };
        await  transporter.sendMail(mailOptions);
        return res.status(200).json({success:true, message:  "If this email exists, a reset link will be sent.", user });
      } else {
          return res.status(404).json({ success:false,message: "User not found" });
      }
  } catch (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
});

router.put("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  
  console.log(token)
  if (!newPassword) {
    return res.status(400).json({ message: "New password is required" });
  }

  try {
    console.log("Current time:", new Date(Date.now()));
    const user = await User.findOne({ resetToken: token,
    resetTokenExpiration: { $gt: Date.now() }});

    console.log(user)

    if (!user) {
      return res.status(404).json({success:false, message: "invalid or expired token " });
    }

    // ✅ Hash the new password
    user.password = await bcrypt.hash(newPassword, 12);
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;
    await user.save();

    res.status(200).json({success:true, message: "Password updated successfully" });
  } catch (error) {
    console.error("from update password:",error)
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/:id/updateuser",auth,async(req,res)=>{
  try{
    const {Department,canApprove,name,email,password,role,WorkStatus}=req.body
    const {id}=req.params
    const user_update=await User.findById(id)
    if (!user_update) {
      return res.status(404).json({ message: "User not found" });
    }
        
    if (Department){
      user_update.Department=Department
    }
    if (email){
      user_update.email=email

    }
    if (canApprove){
      user_update.canApprove=canApprove
    }
    if (name){
      user_update.name=name
    }
    if(WorkStatus){
      user_update.WorkStatus=WorkStatus
    }
    if(role){
      user_update.role=role
    }
    if (typeof password === 'string' && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      User.password = hashedPassword;
    }

    await user_update.save()
    res.status(200).json({success:true,message:"user details updated successfully",data:user_update})

  }catch(error){
    console.error("this error originated from users PUT:",error)
    res.status(500).json({success:false,message:"server error"})
  }
})
//delete User
router.delete('/:id',csrfProtection,async (req,res)=>{
  try{
      const deleteuser=await User.findByIdAndDelete(req.params.id)
      if (!deleteuser){
        return res.status(404).json({ message: "User not found" });
      }res.json({ message: "Order deleted successfully" });
      

  }catch(err){
    res.status(500).json({ message: "Error deleting User", err });
  }
})

module.exports=router;