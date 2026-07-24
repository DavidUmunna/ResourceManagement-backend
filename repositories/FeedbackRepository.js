// backend/src/repositories/FeedbackRepository.js
const  BaseRepository  = require('./BaseRepository');
const  FeedbackModel  = require('../models/Feedback');

class FeedbackRepository extends BaseRepository {
  constructor() {
    super(FeedbackModel);
  }

  async findByFilter(filter = {}) {
    const query = {};
    
    if (filter?.type) query.type = filter.type;
    if (filter?.status) query.status = filter.status;
    if (filter?.userId) query.userId = filter.userId;
    
    if (filter?.fromDate || filter?.toDate) {
      query.createdAt = {};
      if (filter.fromDate) query.createdAt.$gte = filter.fromDate;
      if (filter.toDate) query.createdAt.$lte = filter.toDate;
    }
    
    return this.findAll(query);
  }

  async updateStatus(id, status) {
    return this.update(id, { status });
  }

  toDomain(document) {
    return {
      id: document.id,
      type: document.type,
      title: document.title,
      description: document.description,
      userId: document.userId,
      email: document.email,
      status: document.status,
      priority: document.priority,
      metadata: document.metadata,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}

module.exports =  FeedbackRepository ;