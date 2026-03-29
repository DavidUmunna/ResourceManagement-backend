// backend/src/models/Feedback.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { FeedbackType, FeedbackStatus } = require('../constants/feedback.constants');
const FeedbackSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, default: uuidv4 },
    type: { 
      type: String, 
      enum: Object.values(FeedbackType), 
      required: true 
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    userId: { type: String, sparse: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: { 
      type: String, 
      enum: Object.values(FeedbackStatus), 
      default: FeedbackStatus.PENDING 
    },
    priority: { type: Number, min: 1, max: 5 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

FeedbackSchema.index({ createdAt: -1 });
FeedbackSchema.index({ type: 1, status: 1 });
FeedbackSchema.index({ email: 1 });

const FeedbackModel = mongoose.model('Feedback', FeedbackSchema);

module.exports=FeedbackModel