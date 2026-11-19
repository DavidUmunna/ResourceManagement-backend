// Permission helpers for departments and tasks.
// A user can manage a department if they hold a department-admin role
// or are that department's head (Department.headOfDepartment.user).
const Department = require("../models/Department");
const { DEPARTMENT_ADMIN_ROLES } = require("../constants/department.constants");

const isDepartmentAdmin = (user) => DEPARTMENT_ADMIN_ROLES.includes(user?.role);

// Ids (as strings) of the departments this user heads.
async function headedDepartmentIds(userId) {
  if (!userId) return [];
  const depts = await Department.find({ "headOfDepartment.user": userId }).select("_id").lean();
  return depts.map((d) => String(d._id));
}

async function isHeadOfAnyDepartment(userId) {
  if (!userId) return false;
  return Boolean(await Department.exists({ "headOfDepartment.user": userId }));
}

// department may be a document or a lean object
function isHeadOf(department, userId) {
  const headId = department?.headOfDepartment?.user?._id || department?.headOfDepartment?.user;
  return Boolean(headId) && String(headId) === String(userId);
}

function canManageDepartment(user, department) {
  return isDepartmentAdmin(user) || isHeadOf(department, user?.userId);
}

function isMember(department, userId) {
  return (department?.users || []).some((m) => String(m._id) === String(userId));
}

module.exports = {
  isDepartmentAdmin,
  headedDepartmentIds,
  isHeadOfAnyDepartment,
  isHeadOf,
  canManageDepartment,
  isMember,
};
