// models/Task.js
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user', // Reference to the User model
    required: false,
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department', // Reference to the Department model
    required: false,
  },
  dueDate: {
    type: Date,
    required: false,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user', // Reference to the User model
    required: false,
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed'],
    default: 'Pending',
  },
  // Set when the task moves to Completed, cleared if it is reopened.
  // Used for completion-time stats instead of updatedAt, which changes on any edit.
  completedAt: {
    type: Date,
    default: null,
  },

},{timestamps:true},{strict:true});

module.exports = mongoose.model('tasks', taskSchema);