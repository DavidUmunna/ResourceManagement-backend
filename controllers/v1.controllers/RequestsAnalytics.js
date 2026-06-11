// controllers/poAnalyticsController.js
const PurchaseOrder = require('../../models/PurchaseOrder');
const mongoose=require("mongoose")
exports.getPOAnalytics = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      status, 
      staffId, 
      Department,
      urgency,
      view = 'daily' // daily, monthly, yearly
    } = req.query;
    
    const filter = {};
    const AggregationFilter={}
    
    // Date filtering
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
      AggregationFilter.createdAt={};
       if (startDate) AggregationFilter.createdAt.$gte = new Date(startDate);
      if (endDate) AggregationFilter.createdAt.$lte = new Date(endDate);

    }
    
    // Status filtering
    if (status) filter.status = status;
    
    // Staff filtering
    if (staffId) {filter.staff = staffId;
      AggregationFilter.staff=staffId;
    }
    
    // Department filtering
    if (urgency) filter.urgency = urgency;
    if (Department) AggregationFilter.Department=Department;

    // Get the raw data first for detailed analytics
    const orders = await PurchaseOrder.find(filter)
      .populate('staff', 'name email Department')
      .populate('PendingApprovals', 'name email')
      .lean();

    const filteredOrders = orders.filter(order => 
     {if (Department){

        return order.staff?.Department === Department
      }
      return order;
    }

    );
     
    // Then get aggregated data for the chart

   
    let dateFormat, groupIdFormat;
    switch(view) {
      case 'yearly':
        dateFormat = '%Y';
        groupIdFormat = { $year: '$createdAt' };
        break;
      case 'monthly':
        dateFormat = '%Y-%m';
        groupIdFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      case 'daily':
      default:
        dateFormat = '%Y-%m-%d';
        groupIdFormat = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }
    
 const pipeline = [];

// 1. Match base filters that reference fields already in the collection
if (filter.staff) {
  pipeline.push({
    $match: {
      staff: new mongoose.Types.ObjectId(filter.staff),
    }
  });
}

// 2. Lookup userInfo (from users collection)
pipeline.push({
  $lookup: {
    from: "users",
    localField: "staff",
    foreignField: "_id",
    as: "userInfo"
  }
});

// 3. Flatten the userInfo array
pipeline.push({ $unwind: "$userInfo" });

// 4. Match on Department, now that userInfo exists
if (AggregationFilter.Department) {
  pipeline.push({
    $match: {
      "userInfo.Department": AggregationFilter.Department
    }
  });
}

// 5. Group by your format (daily, monthly, etc.)
pipeline.push({
  $group: {
    _id: groupIdFormat,
    Department: { $first: "$userInfo.Department" },
    date: {
      $first: {
        $dateToString: {
          format: dateFormat,
          date: "$createdAt"
        }
      }
    },
    count: { $sum: 1 },
    totalValue: { $sum: { $sum: "$products.price" } },
    avgApprovalTime: {
      $avg: {
        $subtract: [
          { $max: "$Approvals.timestamp" },
          "$createdAt"
        ]
      }
    },
    statusDistribution: {
      $push: "$status"
    }
  }
});

// 6. Sort the results
pipeline.push({ $sort: { _id: 1 } });

// 7. Run the aggregation
const aggregatedData = await PurchaseOrder.aggregate(pipeline);

  
    
    // Process status distribution
    const processedData = aggregatedData.map(item => {
      const statusCounts = item.statusDistribution.reduce((acc, status) => {
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      return {
        ...item,
        statusCounts
      };
    });
    const totalValue = orders.reduce((sum, order) => {
  const productSum = Array.isArray(order.products)
    ? order.products.reduce((s, p) => s + (Number(p.price) || 0), 0)
    : 0;
  return sum + productSum;
  }, 0);
   
    res.json({
      success: true,
      data: {
        chartData: processedData,
        rawData: filteredOrders.slice(0, 100), // Return first 100 for inspection
        summary: {
          totalOrders: filteredOrders.length,
          totalValue: totalValue,
          avgOrderValue:  filteredOrders.length > 0 ? totalValue / orders.length : 0,
          approvalRate: filteredOrders.length > 0
            ? (filteredOrders.filter(o => o.status === 'Approved').length / filteredOrders.length) * 100
            : 0
        }
      }
    });
    
  
}catch (error) {
    console.error('Error fetching purchase order analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve purchase order analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Additional specialized endpoints
exports.getPOStatusDistribution = async (req, res) => {
  try {
    const distribution = await PurchaseOrder.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: distribution
    });
  } catch (error) {
    console.error('Error fetching status distribution:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve status distribution'
    });
  }
};

exports.getPOUrgencyStats = async (req, res) => {
  try {
    const stats = await PurchaseOrder.aggregate([
      {
        $group: {
          _id: "$urgency",
          count: { $sum: 1 },
          avgProcessingTime: {
            $avg: {
              $cond: [
                { $eq: ["$status", "Completed"] },
                { $subtract: ["$updatedAt", "$createdAt"] },
                null
              ]
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching urgency stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve urgency statistics'
    });
  }
};

// ── Shared helpers ────────────────────────────────────────────────────────────

// Computes total value of an order: sum of (price * quantity) across all products
const totalValueExpr = {
  $sum: {
    $map: {
      input: '$products',
      as: 'p',
      in: { $multiply: ['$$p.price', '$$p.quantity'] },
    },
  },
};

function buildDateMatch(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const range = {};
  if (startDate) range.$gte = new Date(startDate);
  if (endDate)   range.$lte = new Date(endDate);
  return { createdAt: range };
}

// ── GET /analytics/purchase-orders/by-department ─────────────────────────────
// Spend and order count grouped by the requesting staff member's department.
// Query params: startDate, endDate, status
exports.getSpendByDepartment = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;

    const pipeline = [];

    // 1. Optional date + status pre-filter
    const dateMatch = buildDateMatch(startDate, endDate);
    const preMatch = { ...(dateMatch || {}), ...(status ? { status } : {}) };
    if (Object.keys(preMatch).length) pipeline.push({ $match: preMatch });

    // 2. Join to users to get the requesting department
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'staff',
        foreignField: '_id',
        as: '_staffUser',
      },
    });
    pipeline.push({
      $addFields: {
        _department: { $ifNull: [{ $arrayElemAt: ['$_staffUser.Department', 0] }, 'Unknown'] },
      },
    });

    // 3. Group by department
    pipeline.push({
      $group: {
        _id: '$_department',
        totalOrders: { $sum: 1 },
        totalSpend: { $sum: totalValueExpr },
        avgOrderValue: { $avg: totalValueExpr },
        byStatus: {
          $push: '$status',
        },
      },
    });

    // 4. Unpack status array into counts
    pipeline.push({
      $project: {
        _id: 0,
        department: '$_id',
        totalOrders: 1,
        totalSpend: { $round: ['$totalSpend', 2] },
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        statusBreakdown: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$byStatus', []] },
              as: 's',
              in: {
                k: '$$s',
                v: {
                  $size: {
                    $filter: { input: '$byStatus', as: 'x', cond: { $eq: ['$$x', '$$s'] } },
                  },
                },
              },
            },
          },
        },
      },
    });

    pipeline.push({ $sort: { totalSpend: -1 } });

    const data = await PurchaseOrder.aggregate(pipeline);

    const grandTotal = data.reduce((s, d) => s + d.totalSpend, 0);

    return res.json({
      success: true,
      data: {
        byDepartment: data,
        grandTotalSpend: Math.round(grandTotal * 100) / 100,
        filters: { startDate, endDate, status },
      },
    });
  } catch (error) {
    console.error('getSpendByDepartment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve department spend' });
  }
};

// ── GET /analytics/purchase-orders/by-status ─────────────────────────────────
// Spend and order count grouped by approval status.
// Query params: startDate, endDate, department
exports.getSpendByStatus = async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;

    const pipeline = [];

    const dateMatch = buildDateMatch(startDate, endDate);
    if (dateMatch) pipeline.push({ $match: dateMatch });

    // Join users when filtering by department
    if (department) {
      pipeline.push({
        $lookup: {
          from: 'users',
          localField: 'staff',
          foreignField: '_id',
          as: '_staffUser',
        },
      });
      pipeline.push({
        $match: { '_staffUser.Department': department },
      });
    }

    pipeline.push({
      $group: {
        _id: '$status',
        totalOrders: { $sum: 1 },
        totalSpend: { $sum: totalValueExpr },
        avgOrderValue: { $avg: totalValueExpr },
      },
    });

    pipeline.push({
      $project: {
        _id: 0,
        status: '$_id',
        totalOrders: 1,
        totalSpend: { $round: ['$totalSpend', 2] },
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
      },
    });

    // Preserve a consistent status order
    const STATUS_ORDER = ['Pending', 'Approved', 'Completed', 'Rejected', 'More Information', 'Awaiting Funding'];
    pipeline.push({
      $sort: {
        status: 1,
      },
    });

    const data = await PurchaseOrder.aggregate(pipeline);
    data.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

    const approvedSpend = data
      .filter((d) => ['Approved', 'Completed'].includes(d.status))
      .reduce((s, d) => s + d.totalSpend, 0);

    return res.json({
      success: true,
      data: {
        byStatus: data,
        approvedSpend: Math.round(approvedSpend * 100) / 100,
        filters: { startDate, endDate, department },
      },
    });
  } catch (error) {
    console.error('getSpendByStatus error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve status spend' });
  }
};

// ── GET /analytics/purchase-orders/spend-summary ─────────────────────────────
// Single dashboard endpoint: overall totals + breakdown by department + by status.
// Query params: startDate, endDate
exports.getSpendSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const dateMatch = buildDateMatch(startDate, endDate);
    const matchStage = dateMatch ? [{ $match: dateMatch }] : [];

    // Run three aggregations in parallel
    const [overall, byDept, byStatus] = await Promise.all([
      // Overall totals
      PurchaseOrder.aggregate([
        ...matchStage,
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSpend: { $sum: totalValueExpr },
            avgOrderValue: { $avg: totalValueExpr },
          },
        },
      ]),

      // By department (join users)
      PurchaseOrder.aggregate([
        ...matchStage,
        {
          $lookup: {
            from: 'users',
            localField: 'staff',
            foreignField: '_id',
            as: '_staffUser',
          },
        },
        {
          $group: {
            _id: { $ifNull: [{ $arrayElemAt: ['$_staffUser.Department', 0] }, 'Unknown'] },
            totalOrders: { $sum: 1 },
            totalSpend: { $sum: totalValueExpr },
          },
        },
        {
          $project: {
            _id: 0,
            department: '$_id',
            totalOrders: 1,
            totalSpend: { $round: ['$totalSpend', 2] },
          },
        },
        { $sort: { totalSpend: -1 } },
      ]),

      // By status
      PurchaseOrder.aggregate([
        ...matchStage,
        {
          $group: {
            _id: '$status',
            totalOrders: { $sum: 1 },
            totalSpend: { $sum: totalValueExpr },
          },
        },
        {
          $project: {
            _id: 0,
            status: '$_id',
            totalOrders: 1,
            totalSpend: { $round: ['$totalSpend', 2] },
          },
        },
      ]),
    ]);

    const totals = overall[0] || { totalOrders: 0, totalSpend: 0, avgOrderValue: 0 };

    return res.json({
      success: true,
      data: {
        totals: {
          totalOrders: totals.totalOrders,
          totalSpend: Math.round((totals.totalSpend || 0) * 100) / 100,
          avgOrderValue: Math.round((totals.avgOrderValue || 0) * 100) / 100,
        },
        byDepartment: byDept,
        byStatus: byStatus,
        filters: { startDate, endDate },
      },
    });
  } catch (error) {
    console.error('getSpendSummary error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve spend summary' });
  }
};