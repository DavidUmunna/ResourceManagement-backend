const mongoose = require('mongoose');
const User=require("./users_")
const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  headOfDepartment: {
    user: {  // Better field name than just _id
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: false
    },
    name: {
      type: String,
      required: false
    }
  },
  users: [{
    
    _id: {  // Better field name than _id
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: false
    },
    name: {
      type: String,
      required: false
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: false  // Added required if this is mandatory
  }
}, { timestamps: true });
departmentSchema.pre('save', async function(next) {
  try {
    // Update head's name if user reference changed
    if (this.isModified('headOfDepartment.user') && this.headOfDepartment.user) {
      const user = await User.findById(this.headOfDepartment.user).select('name');
      this.headOfDepartment.name = user?.name || null;
    }

    // Update names for modified user references in users array
    // Members are stored as { _id: <user id>, name }; fill in any missing names
    if (this.isModified('users')) {
      await Promise.all(this.users.map(async (member, index) => {
        if (member._id && !member.name) {
          const userDoc = await User.findById(member._id).select('name');
          this.users[index].name = userDoc?.name || null;
        }
      }));
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Department', departmentSchema);