// Single source of truth for who can manage every department.
// Served to the frontend through /api/roles&departments (ADMIN_ROLES_DEPARTMENT)
// and enforced server-side by services/departmentAccess.js.
const DEPARTMENT_ADMIN_ROLES = ["admin", "global_admin", "human_resources"];

const TASK_STATUSES = ["Pending", "In Progress", "Completed"];

module.exports = { DEPARTMENT_ADMIN_ROLES, TASK_STATUSES };
