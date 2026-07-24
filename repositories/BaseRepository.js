// backend/src/repositories/BaseRepository.js
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    const document = new this.model(data);
    await document.save();
    return this.toDomain(document);
  }

  async findById(id) {
    const document = await this.model.findOne({ id });
    return document ? this.toDomain(document) : null;
  }

  async findAll(filter = {}) {
    const documents = await this.model.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);
    return documents.map(doc => this.toDomain(doc));
  }

  async update(id, data) {
    const document = await this.model.findOneAndUpdate(
      { id },
      { $set: data },
      { new: true }
    );
    return document ? this.toDomain(document) : null;
  }

  async delete(id) {
    const result = await this.model.findOneAndDelete({ id });
    return result !== null;
  }

  async count(filter = {}) {
    return this.model.countDocuments(filter);
  }

  toDomain(document) {
    return document.toObject();
  }
}

module.exports=BaseRepository;