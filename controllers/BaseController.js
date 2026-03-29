// backend/src/controllers/BaseController.js
class BaseController {
  handleError(res, error) {
    console.error('Controller error:', error);
    
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    
    res.status(statusCode).json({
      success: false,
      error: message
    });
  }
  
  handleSuccess(res, data, statusCode = 200) {
    res.status(statusCode).json({
      success: true,
      data
    });
  }
}

module.exports=BaseController;