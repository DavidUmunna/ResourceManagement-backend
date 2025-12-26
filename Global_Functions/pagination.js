// middlewares/pagination.js
const getPagination = (req, defaultLimit = 15) => {
    const page = Math.abs(parseInt(req.query.page)) || 1;
    const limit = Math.min(Math.abs(parseInt(req.query.limit)) || defaultLimit, 3500);
    const skip = (page - 1) * limit;
  
    return { page, limit, skip };
  };
  
  const getPagingData = (total, page, limit) => {
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
  
    return {
      total,
      page,
      limit,
      totalPages,
      hasNextPage,
      hasPrevPage
    };
  };
  
  module.exports = { getPagination, getPagingData };