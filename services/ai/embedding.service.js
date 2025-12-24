// Simple placeholder embedding service storing raw text; integrates with vectorStore
const vectorStore = require("../../adapters/search/vectorStore");

module.exports = {
  indexText(text, metadata) {
    if (!text) return null;
    return vectorStore.upsert(text, metadata);
  },
  search(query, options) {
    return vectorStore.search(query, options);
  },
};
