const express = require('express');
const router = express.Router();
const AssetItem = require('../../models/Assets');
const AssetExpenditure = require('../../models/AssetExpenditure');
const auth = require('../../middlewares/check-auth');
const { getPagination,getPagingData } = require('../../Global_Functions/pagination');
const ExcelJS=require('exceljs')
function generateSKU(name) {
  if (name && typeof name !=="string") return
  const prefix = name.substring(0, 3).toUpperCase(); 
  const unique = Date.now().toString().slice(-5);    
  return `${prefix}-${unique}`;     
}                 
router.get('/', auth, async (req, res) => {
  try {
    const {page,limit,skip}=getPagination(req);
    const { category, subCategory, condition, search } = req.query;
    const filter = {};

    if (category && category !== 'All') filter.category = category;
    if (subCategory && subCategory !== 'All') filter.subCategory = subCategory;
    if (condition) filter.condition = condition;

    if (search && typeof search ==="string") {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } }
      ];
    }

    const [total,items] = await Promise.all([
      AssetItem.countDocuments(filter),
      AssetItem.find(filter)
      .sort({ lastUpdated: -1 })
      .lean()
      .skip(skip)
      .limit(limit)])

    res.json({ success: true, data: items,Pagination:getPagingData(total,page,limit) });
  } catch (err) {
    console.error("error originated from asset get route:",err)
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});
router.get('/categories', auth, async (req, res) => {
  try {
    const categories = ['IT_equipment', 'Furniture', 'waste_management', 'lab', 'PVT', 'Other'];
    res.json({ success: true, data: { categories } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// Returns distinct subCategories from the DB, optionally filtered by category
router.get('/subcategories', auth, async (req, res) => {
  try {
    const { category } = req.query;
    const match = { subCategory: { $exists: true, $ne: null } };
    if (category && category !== 'All') match.category = category;

    const subCategories = await AssetItem.distinct('subCategory', match);
    res.json({ success: true, data: { subCategories: subCategories.sort() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch sub-categories' });
  }
});
// @route   POST /apiAsset
// @desc    Create newAsset item
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, subCategory, quantity, condition, description, value, location } = req.body;
    const sku=generateSKU(name)
    const newItem = new AssetItem({
      name,
      category,
      ...(subCategory && { subCategory }),
      quantity,
      condition,
      description,
      value,
      sku,
      ...(location && { location }),
    });

    

    await newItem.save();
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    console.error("a posting error:",err)
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: Object.values(err.errors).map(val => val.message) 
      });
    }
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// @route   PUT /apiAsset/:id
// @desc    UpdateAsset item
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, subCategory, quantity, condition, description, value, location } = req.body;

    const update = {
      name,
      category,
      quantity,
      condition,
      description,
      value: value ?? 0,
      lastUpdated: Date.now(),
      ...(location && { location }),
    };

    // Allow explicitly clearing subCategory by passing null/empty string
    if (subCategory !== undefined) {
      update.subCategory = subCategory || null;
    }

    const updatedItem = await AssetItem.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: updatedItem });
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

// @route   DELETE /apiAsset/:id
// @desc    DeleteAsset item
// @access  Private (Admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const deletedItem = await AssetItem.findByIdAndDelete(req.params.id);
    
    if (!deletedItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.json({ success: true, data: {} });
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// @route   GET /api/Asset/stats
// @desc    GetAsset statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    const [
      totalItems,
      totalQuantityAgg,
      categories,
      conditionStats,
      totalValueAgg,
      subCategoryStats,
      expenditureRecords,
    ] = await Promise.all([
      AssetItem.countDocuments(),
      AssetItem.aggregate([{ $group: { _id: null, total: { $sum: '$quantity' } } }]),
      AssetItem.distinct('category'),
      AssetItem.aggregate([{ $group: { _id: '$condition', count: { $sum: 1 } } }]),
      AssetItem.aggregate([{ $group: { _id: null, total: { $sum: { $multiply: ['$quantity', '$value'] } } } }]),
      AssetItem.aggregate([
        { $match: { subCategory: { $exists: true, $ne: null } } },
        { $group: {
            _id: '$subCategory',
            count: { $sum: 1 },
            totalQuantity: { $sum: '$quantity' },
            totalValue: { $sum: { $multiply: ['$quantity', '$value'] } },
        }},
        { $sort: { _id: 1 } },
      ]),
      AssetExpenditure.find().sort({ subCategory: 1 }).lean(),
    ]);

    const expenditureBySubCategory = expenditureRecords.map(r => ({
      category: r.category,
      subCategory: r.subCategory,
      totalExpenditure: r.totalExpenditure,
      orderCount: r.orderCount,
      lastExpenseAt: r.updatedAt,
    }));
    const totalExpenditure = expenditureRecords.reduce((sum, r) => sum + (r.totalExpenditure || 0), 0);

    res.json({
      success: true,
      data: {
        totalItems,
        totalQuantity: totalQuantityAgg[0]?.total || 0,
        totalCategories: categories.length,
        totalValue: totalValueAgg[0]?.total || 0,
        conditionStats,
        subCategoryStats,
        expenditureBySubCategory,
        totalExpenditure,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Maintenance expenditure, optionally filtered to a date range.
// Without dates it returns the all-time totals (same as /stats).
router.get('/expenditure', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const hasRange = startDate || endDate;

    let expenditureBySubCategory;
    if (hasRange) {
      const atFilter = {};
      if (startDate) atFilter.$gte = new Date(startDate);
      if (endDate)   atFilter.$lte = new Date(endDate);

      const agg = await AssetExpenditure.aggregate([
        { $unwind: '$entries' },
        { $match: { 'entries.at': atFilter } },
        { $group: {
            _id: { category: '$category', subCategory: '$subCategory' },
            totalExpenditure: { $sum: '$entries.amount' },
            orderCount: { $sum: 1 },
            lastExpenseAt: { $max: '$entries.at' },
        }},
        { $sort: { '_id.subCategory': 1 } },
      ]);
      expenditureBySubCategory = agg.map(r => ({
        category: r._id.category,
        subCategory: r._id.subCategory,
        totalExpenditure: r.totalExpenditure,
        orderCount: r.orderCount,
        lastExpenseAt: r.lastExpenseAt,
      }));
    } else {
      const records = await AssetExpenditure.find().sort({ subCategory: 1 }).lean();
      expenditureBySubCategory = records.map(r => ({
        category: r.category,
        subCategory: r.subCategory,
        totalExpenditure: r.totalExpenditure,
        orderCount: r.orderCount,
        lastExpenseAt: r.updatedAt,
      }));
    }

    const totalExpenditure = expenditureBySubCategory.reduce((s, r) => s + (r.totalExpenditure || 0), 0);
    res.json({ success: true, data: { expenditureBySubCategory, totalExpenditure } });
  } catch (err) {
    console.error('error originated from asset expenditure route:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

router.post("/export", auth, async (req, res) => {
  try {
    const { startDate, endDate, category, subCategory, filename } = req.body;

    if (!startDate || !endDate || !filename) {
      return res.status(400).json({ message: "startDate, endDate, and filename are required" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (start > end) {
      return res.status(400).json({ message: "startDate must be before endDate" });
    }

    const query = { createdAt: { $gte: start, $lte: end } };
    if (category && category !== "All") query.category = category;
    if (subCategory && subCategory !== "All") query.subCategory = subCategory;

    const assetItems = await AssetItem.find(query).lean();

    const sanitizedFileName = filename.replace(/[^a-zA-Z0-9-_]/g, '_');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${sanitizedFileName}-${Date.now()}.xlsx`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Asset Items');

    worksheet.columns = [
      { header: "Name",         key: "name",        width: 30 },
      { header: "Category",     key: "category",    width: 20 },
      { header: "Sub-Category", key: "subCategory", width: 25 },
      { header: "Condition",    key: "condition",   width: 15 },
      { header: "SKU",          key: "sku",         width: 22 },
      { header: "Quantity",     key: "quantity",    width: 12 },
      { header: "Value (NGN)",  key: "value",       width: 18 },
      { header: "Description",  key: "description", width: 35 },
      { header: "Location",     key: "location",    width: 20 },
      { header: "Active",       key: "active",      width: 10 },
      { header: "Last Updated", key: "lastUpdated", width: 20 },
      { header: "Created At",   key: "createdAt",   width: 20 },
    ];

    assetItems.forEach((item) => {
      worksheet.addRow({
        name:        item.name || '',
        category:    item.category || '',
        subCategory: item.subCategory || '',
        condition:   item.condition || '',
        sku:         item.sku || '',
        quantity:    item.quantity || 0,
        value:       item.value || 0,
        description: item.description || '',
        location:    item.location || 'Head Office',
        active:      item.active ? 'Yes' : 'No',
        lastUpdated: item.lastUpdated instanceof Date
          ? item.lastUpdated.toISOString().slice(0, 10)
          : (item.lastUpdated?.slice(0, 10) || ''),
        createdAt:   item.createdAt instanceof Date
          ? item.createdAt.toISOString().slice(0, 10)
          : (item.createdAt?.slice(0, 10) || ''),
      });
    });

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error exporting asset items:", error);
    res.status(500).json({ message: "Server error during export" });
  }
});

module.exports = router;