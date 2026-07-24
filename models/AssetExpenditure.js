const mongoose = require('mongoose');
const { Schema } = mongoose;

// Accumulated maintenance expenditure per asset sub-category.
// Incremented when a maintenance purchase order is fully approved.
const AssetExpenditureSchema = new Schema({
  category: {
    type: String,
    required: true,
  },
  subCategory: {
    type: String,
    required: true,
  },
  totalExpenditure: {
    type: Number,
    default: 0,
    min: 0,
  },
  orderCount: {
    type: Number,
    default: 0,
  },
  // Lightweight audit trail of contributing orders
  entries: [{
    order:  { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    amount: { type: Number },
    at:     { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// One expenditure record per (category, subCategory)
AssetExpenditureSchema.index({ category: 1, subCategory: 1 }, { unique: true });

module.exports = mongoose.model('AssetExpenditure', AssetExpenditureSchema);
