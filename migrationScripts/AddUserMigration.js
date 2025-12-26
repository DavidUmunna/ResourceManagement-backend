const mongoose = require("mongoose");
const User = require("../models/users_");

require("dotenv").config({ path: "../.env" });

const userData = {
  name: "",
  email: "",
  password: "",
  Department: "",
  role: "",
  canApprove: false,
  WorkStatus: "",
  NotificationToken: "",
};

const validateUserData = (data) => {
  const requiredFields = ["name", "email", "password"];
  const missing = requiredFields.filter((field) => !data[field]);
  if (missing.length > 0) {
    throw new Error(
      `Fill required fields before running: ${missing.join(", ")}`
    );
  }
};

const addUser = async () => {
  try {
    validateUserData(userData);
    await mongoose.connect(process.env.MONGO_URI);
    const created = await User.create(userData);
    console.log("User created:", created._id);
  } catch (error) {
    console.error("User migration failed:", error);
  } finally {
    await mongoose.disconnect();
  }
};

addUser();
