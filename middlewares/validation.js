// backend/src/middlewares/validation.js
const { body, validationResult } =require('express-validator');

const validateFeedback = [
  body('type').isIn(['issue', 'improvement']).withMessage('Invalid feedback type'),
  body('title').trim().isLength({ min: 3, max: 200 }).withMessage('Title must be between 3 and 200 characters'),
  body('description').trim().isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('priority').optional().isInt({ min: 1, max: 5 }).withMessage('Priority must be between 1 and 5'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    next();
  }
];

module.exports=validateFeedback;