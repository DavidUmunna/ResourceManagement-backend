const service = require("../../services/skipInsights.service");

exports.getSkipInsights = async (req, res) => {
  try {
    const data = await service.compute(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("skipInsights error:", error);
    return res.status(500).json({ success: false, message: "Failed to compute skip insights" });
  }
};
