// removeReviewer.js
require('dotenv').config({ path: './.env' });
const mongoose = require("mongoose");
const PurchaseOrder = require("../models/PurchaseOrder"); // adjust path if needed

// 🔧 CONFIG
const MONGO_URI = process.env.MONGO_URI||"mongodb://AppUser:Haldenng123@127.0.0.1:27017/Haldenresources?authSource=admin";
const REVIEWER_ID = "6830789898ef43e5803ea02c";

const run = async () => {
  try {
    // 1. Connect to DB
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to database");

    const reviewerObjectId = new mongoose.Types.ObjectId(REVIEWER_ID);

    // (Optional but smart) Check how many will be affected
    const count = await PurchaseOrder.countDocuments({
      "PendingApprovals.Reviewer": reviewerObjectId
    });

    console.log(`🔍 Found ${count} purchase orders with this reviewer`);

    if (count === 0) {
      console.log("⚠️ Nothing to remove");
      return;
    }

    // 2. Remove reviewer from all PendingApprovals
    const result = await PurchaseOrder.updateMany(
      {
        "PendingApprovals.Reviewer": reviewerObjectId
      },
      {
        $pull: {
          PendingApprovals: { Reviewer: reviewerObjectId }
        }
      }
    );

    console.log(`✅ Done. Modified ${result.modifiedCount} purchase orders`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    // 3. Close connection
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
};

// Run script
run();