const { Document, Packer, Paragraph, HeadingLevel } = require("docx");

module.exports = {
  async render(drafts) {
    const children = [];
    drafts.forEach((d) => {
      children.push(
        new Paragraph({ text: d.section, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: d.content || "" })
      );
    });
    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
  },
};
