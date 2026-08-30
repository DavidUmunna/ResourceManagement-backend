const projectRepo = require("../repositories/project.repository");
const { logComplianceAction } = require("./ComplianceLog.service");

const httpError = (message, status) => Object.assign(new Error(message), { status });
const actorFrom = (user) => ({ id: user?.userId, name: user?.name, role: user?.role, model: "user" });

const logProject = (project, opts) =>
  logComplianceAction({
    entityType: "Project",
    entityModel: "project",
    entityId: project._id,
    entityName: project.name,
    ...opts,
  });

exports.createProject = async (user, payload = {}) => {
  if (!payload.name || !String(payload.name).trim()) throw httpError("Project name is required", 400);

  if (payload.code) {
    const existing = await projectRepo.findByCode(String(payload.code).trim());
    if (existing) throw httpError(`A project with code "${payload.code}" already exists`, 409);
  }

  const project = await projectRepo.create({
    name: String(payload.name).trim(),
    code: payload.code ? String(payload.code).trim() : undefined,
    client: payload.client,
    site: payload.site,
    dailyRateUsd: payload.dailyRateUsd != null ? Number(payload.dailyRateUsd) : 0,
  });

  await logProject(project, {
    action: "CREATE",
    actor: actorFrom(user),
    description: `Project ${project.name}${project.code ? ` (${project.code})` : ""} created`,
  });
  return project;
};

exports.listProjects = (filter = {}) => projectRepo.findAll(filter);

exports.getProject = async (id) => {
  const project = await projectRepo.findById(id);
  if (!project) throw httpError("Project not found", 404);
  return project;
};

exports.updateProject = async (user, id, payload = {}) => {
  const existing = await projectRepo.findById(id);
  if (!existing) throw httpError("Project not found", 404);

  if (payload.code && payload.code !== existing.code) {
    const clash = await projectRepo.findByCode(String(payload.code).trim());
    if (clash) throw httpError(`A project with code "${payload.code}" already exists`, 409);
  }

  const updated = await projectRepo.update(id, payload);
  await logProject(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: `Project ${updated.name} updated`,
    changedFields: Object.keys(payload || {}),
  });
  return updated;
};
