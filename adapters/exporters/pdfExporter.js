// Placeholder PDF exporter; returns a Buffer with simple text
module.exports = {
  async render(drafts) {
    const content = drafts
      .map((d) => `### ${d.section}\n${d.content || ""}`)
      .join("\n\n");
    return Buffer.from(content, "utf8");
  },
};
