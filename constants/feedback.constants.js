// backend/src/constants/feedback.constants.js
 const FeedbackType = {
  issue: 'issue',
  IMPROVEMENT: 'improvement'
};

 const FeedbackStatus = {
  PENDING: 'pending',
  IN_REVIEW: 'in_review',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  IMPLEMENTED: 'implemented'
};
const FeedbackPriority = {
  LOW: 1,
  MEDIUM: 3,
  HIGH: 5
};

module.exports={FeedbackPriority,FeedbackStatus,FeedbackType}