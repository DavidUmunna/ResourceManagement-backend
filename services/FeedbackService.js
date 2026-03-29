// backend/src/services/FeedbackService.js
class FeedbackService {
  constructor(repository, validator, notificationService) {
    this.repository = repository;
    this.validator = validator;
    this.notificationService = notificationService;
  }
  
  async createFeedback(data) {
    console.log("the data",data)
    const validation = this.validator.validate(data);
    console.log("thisis tehfeedback type",validation)
    if (!validation.isValid) {
      const error = new Error(`Validation failed: ${validation.errors.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    
    const feedback = await this.repository.create(data);
    
    // Send confirmation email asynchronously (don't await)
    this.notificationService.sendConfirmation(feedback).catch(console.error);
    
    return feedback;
  }
  
  async getFeedbackById(id) {
    const feedback = await this.repository.findById(id);
    if (!feedback) {
      const error = new Error('Feedback not found');
      error.statusCode = 404;
      throw error;
    }
    return feedback;
  }
  
  async getAllFeedback(filter = {}) {
    return this.repository.findByFilter(filter);
  }
  
  async updateFeedbackStatus(id, status) {
    const feedback = await this.repository.updateStatus(id, status);
    if (!feedback) {
      const error = new Error('Feedback not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Send status update notification
    this.notificationService.sendStatusUpdate(feedback).catch(console.error);
    
    return feedback;
  }
  
  async deleteFeedback(id) {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      const error = new Error('Feedback not found');
      error.statusCode = 404;
      throw error;
    }
  }
  
  async getFeedbackStats() {
    const [allFeedbacks, totalCount] = await Promise.all([
      this.repository.findAll(),
      this.repository.count()
    ]);
    
    const byType = {};
    const byStatus = {};
    
    allFeedbacks.forEach(feedback => {
      byType[feedback.type] = (byType[feedback.type] || 0) + 1;
      byStatus[feedback.status] = (byStatus[feedback.status] || 0) + 1;
    });
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentCount = allFeedbacks.filter(
      f => new Date(f.createdAt) >= sevenDaysAgo
    ).length;
    
    return {
      total: totalCount,
      byType,
      byStatus,
      recentCount
    };
  }
}

module.exports={FeedbackService};