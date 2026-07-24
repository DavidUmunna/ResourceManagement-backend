const mongoose = require('mongoose');
const { Schema } = mongoose;

// Define the Inventory Item Schema
const AssetItemSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    maxlength: [100, 'Item name cannot exceed 100 characters']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: ['IT_equipment', 'Furniture', 'Office_Supplies', 'waste_management',"lab","PVT", 'Other'],
      message: 'Invalid category'
    }
  },
  condition: {
    type: String,
    required: [true, 'Condition is required'],
    enum: {
      values: ['New', 'Used', 'Refurbished', 'Damaged',"OK"],
      message: 'Invalid condition'
    },
    default: 'New'
  },
  sku: {
    type: String,
  
    required: true,
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0, 'Quantity cannot be negative'],
    default: 1
  },
  value: {
    type: Number,
    required: [true, 'Value is required'],
    min: [0, 'Value cannot be negative']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  location: {
    type:String,
    default:"Head Office"
  },

  subCategory: {
    type: String,
    trim: true,
  },
 
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for total inventory value (quantity * value)
AssetItemSchema.virtual('totalValue').get(function() {
  return this.quantity * this.value;
});

// Indexes for better query performance
AssetItemSchema.index({ name: 'text', category: 1, condition: 1 });
AssetItemSchema.index({ sku: 1 }, { unique: true });
AssetItemSchema.index({ category: 1, subCategory: 1 });

// Middleware to handle SKU generation if not provided

// Static method for inventory summary by condition
AssetItemSchema.statics.getConditionSummary = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$condition',
        count: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' },
        totalValue: { $sum: { $multiply: ['$quantity', '$value'] } }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

// Model export
const AssetItem = mongoose.model('AssetItem', AssetItemSchema);

module.exports = AssetItem;

