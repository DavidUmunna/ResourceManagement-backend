// backend/src/services/validation/FeedbackValidator.js
const BaseValidator  =require('./BaseValidator.js');
const  FeedbackType  = require('../../constants/feedback.constants.js');

class FeedbackValidator extends BaseValidator {
  validate(data) {
    const errors = [];
    console.log("from validation",data)
    // Validate type
    console.log("the data type",data.type)
    console.log("the types",FeedbackType)
    if (!data.type || !Object.values(FeedbackType.FeedbackType).includes(data.type)) {
      errors.push('Invalid feedback type');
    }
    
    // Validate title
    const titleError = this.validateMinLength(data.title, 3, 'Title');
    if (titleError) errors.push(titleError);
    
    const titleMaxError = this.validateMaxLength(data.title, 200, 'Title');
    if (titleMaxError) errors.push(titleMaxError);
    
    // Validate description
    const descError = this.validateMinLength(data.description, 10, 'Description');
    if (descError) errors.push(descError);
    
    // Validate email
    if (!data.email || !this.validateEmail(data.email)) {
      errors.push('Valid email is required');
    }
    
    // Validate priority
    if (data.priority && (data.priority < 1 || data.priority > 5)) {
      errors.push('Priority must be between 1 and 5');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports={FeedbackValidator};