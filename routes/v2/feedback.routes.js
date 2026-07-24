// procurement_api/routes/v2/feedback.routes.js
const { Router } = require('express');
const validateFeedback  = require('../../middlewares/validation');
const createFeedbackRoutes = (controller) => {
  // Validate controller and its methods
  if (!controller) {
    throw new Error('Controller is required for feedback routes');
  }
  
  // Check if controller methods exist and are functions
  const requiredMethods = [
    'createFeedback',
    'getFeedbackById', 
    'getAllFeedback',
    'updateFeedbackStatus',
    'deleteFeedback',
    'getStats'
  ];
  
  requiredMethods.forEach(method => {
    if (typeof controller[method] !== 'function') {
      console.error(`Controller method '${method}' is missing or not a function`);
      console.error('Available controller methods:', Object.keys(controller));
      throw new Error(`Controller.${method} must be a function`);
    }
  });
  
  const router = Router();

  console.log(typeof validateFeedback);
console.log(typeof controller?.createFeedback);
  // Use arrow functions to preserve context
  router.post('/', validateFeedback, 
    controller.createFeedback
  );
  
  router.get('/', (req, res) => {
    controller.getAllFeedback(req, res);
  });
  
  router.get('/stats', (req, res) => {
    controller.getStats(req, res);
  });
  
  router.get('/:id', (req, res) => {
    controller.getFeedbackById(req, res);
  });
  
  router.patch('/:id/status', (req, res) => {
    controller.updateFeedbackStatus(req, res);
  });
  
  router.delete('/:id', (req, res) => {
    controller.deleteFeedback(req, res);
  });
  
  return router;
};

module.exports = createFeedbackRoutes;