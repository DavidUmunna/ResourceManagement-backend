require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");
const User = require("../models/users_");

const ADMIN_USER = {
  _id: new mongoose.Types.ObjectId("68306b205302544582c59f35"),
  name: "Umunna David",
  email: "david.umunna@haldengroup.ng",
  Department: "IT",
  password: "$2b$12$OkK7837TSdcpd.fVIKJxw.MsZQ09N6THcbqpOyUkxstHAWb2CPi66",
  canApprove: true,
  role: "global_admin",
};

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const result = await User.findOneAndUpdate(
      { email: ADMIN_USER.email },
      { $setOnInsert: ADMIN_USER },
      { upsert: true, new: true, rawResult: true }
    );

    if (result.lastErrorObject?.updatedExisting) {
      console.log("ℹ️  User already exists — no changes made.");
    } else {
      console.log("✅ Admin user seeded successfully:", ADMIN_USER.email);
    }
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
};

seed();
