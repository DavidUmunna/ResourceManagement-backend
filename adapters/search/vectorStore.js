// Naive in-memory vector store using string similarity
const { v4: uuidv4 } = require("uuid");

const store = [];

function similarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().split(/\W+/));
  const setB = new Set(b.toLowerCase().split(/\W+/));
  const intersection = [...setA].filter((x) => setB.has(x));
  const score = intersection.length / Math.max(setA.size, setB.size || 1);
  return score;
}

module.exports = {
  upsert(text, metadata = {}) {
    const id = uuidv4();
    store.push({ id, text, metadata });
    return id;
  },
  search(query, { topK = 5, filter = {} } = {}) {
    const results = store
      .filter((item) => {
        if (filter.valid === true) {
          const now = Date.now();
          if (item.metadata.validTo && new Date(item.metadata.validTo).getTime() < now) {
            return false;
          }
        }
        return true;
      })
      .map((item) => ({ ...item, score: similarity(query, item.text) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return results;
  },
};
