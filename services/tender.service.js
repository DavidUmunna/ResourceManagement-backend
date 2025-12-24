const tenderRepo = require("../repositories/tender.repository");
const auditRepo = require("../repositories/audit.repository");

module.exports = {
  async create(payload, user) {
    const tender = await tenderRepo.create({ ...payload, createdBy: user?.userId });
    await auditRepo.log(user?.userId, "CREATE_TENDER", "Tender", tender._id.toString(), {
      title: tender.title,
    });
    return tender;
  },
  async list(filter, pagination) {
    const [total, data] = await Promise.all([
      tenderRepo.count(filter),
      tenderRepo.find(filter, pagination),
    ]);
    return { total, data };
  },
  async get(id) {
    return tenderRepo.findById(id);
  },
  async update(id, update, user) {
    const tender = await tenderRepo.updateById(id, { ...update, updatedAt: new Date() });
    if (tender) {
      await auditRepo.log(user?.userId, "UPDATE_TENDER", "Tender", id, update);
    }
    return tender;
  },
};
