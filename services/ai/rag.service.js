const embeddingService = require("./embedding.service");

module.exports = {
  retrieveContext(query, { topK = 5, filter = {} } = {}) {
    return embeddingService.search(query, { topK, filter });
  },
};
