// backend/src/controllers/FeedbackController.js
const  BaseController =require('./BaseController.js');

class FeedbackController extends BaseController {
    constructor(feedbackService) {
    super();
    this.feedbackService = feedbackService;
    
    // Bind methods
    this.createFeedback = this.createFeedback.bind(this);
    this.getFeedbackById = this.getFeedbackById.bind(this);
    this.getAllFeedback = this.getAllFeedback.bind(this);
    this.updateFeedbackStatus = this.updateFeedbackStatus.bind(this);
    this.deleteFeedback = this.deleteFeedback.bind(this);
    this.getStats = this.getStats.bind(this);
    }
  
    async createFeedback(req, res) {
    try {
      const feedbackData = req.body;
      const feedback = await this.feedbackService.createFeedback(feedbackData);
      this.handleSuccess(res, feedback, 201);
    } catch (error) {
      this.handleError(res, error);
    }
    }
    
    async getFeedbackById(req, res) {
    try {
      const { id } = req.params;
      const feedback = await this.feedbackService.getFeedbackById(id);
      this.handleSuccess(res, feedback);
    } catch (error) {
      this.handleError(res, error);
    }
  }
  
  async getAllFeedback(req, res) {
    try {
      const { type, status, fromDate, toDate } = req.query;
      
      const filter = {};
      if (type) filter.type = type;
      if (status) filter.status = status;
      if (fromDate) filter.fromDate = new Date(fromDate);
      if (toDate) filter.toDate = new Date(toDate);
      
      const feedbacks = await this.feedbackService.getAllFeedback(filter);
      this.handleSuccess(res, feedbacks);
    } catch (error) {
      this.handleError(res, error);
    }
  }
  
  async updateFeedbackStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const feedback = await this.feedbackService.updateFeedbackStatus(id, status);
      this.handleSuccess(res, feedback);
    } catch (error) {
      this.handleError(res, error);
    }
  }
  
  async deleteFeedback(req, res) {
    try {
      const { id } = req.params;
      await this.feedbackService.deleteFeedback(id);
      this.handleSuccess(res, { message: 'Feedback deleted successfully' }, 204);
    } catch (error) {
      this.handleError(res, error);
    }
  }
  
  async getStats(req, res) {
    try {
      const stats = await this.feedbackService.getFeedbackStats();
      this.handleSuccess(res, stats);
    } catch (error) {
      this.handleError(res, error);
    }
  }
}

module.exports={FeedbackController};