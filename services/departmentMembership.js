// Keeps users.Department in step with department membership.
//
// Source of truth: the member list in the Department collection.
// users.Department is a single "home" department used elsewhere (e.g. purchase-order
// routing), so it is kept as a mirror of membership:
//   - joining a department sets it to that department (most recent join wins);
//   - leaving a department clears it only if it pointed there, falling back to
//     another department the user still belongs to, else unsetting it;
//   - renaming a department updates the members that pointed at the old name.
// Only names that exist in the user model's Department enum are written.
const User = require("../models/users_");
const Department = require("../models/Department");

const validNames = () => User.schema.path("Department").enumValues || [];
const isValidName = (name) => validNames().includes(name);

async function onMemberAdded(userId, departmentName) {
  if (!isValidName(departmentName)) return;
  await User.updateOne({ _id: userId }, { $set: { Department: departmentName } });
}

async function onMemberRemoved(userId, departmentName, departmentId) {
  const user = await User.findById(userId).select("Department").lean();
  if (!user || user.Department !== departmentName) return;

  const other = await Department.findOne({
    _id: { $ne: departmentId },
    "users._id": userId,
  }).select("name").lean();

  if (other && isValidName(other.name)) {
    await User.updateOne({ _id: userId }, { $set: { Department: other.name } });
  } else {
    await User.updateOne({ _id: userId }, { $unset: { Department: "" } });
  }
}

async function onDepartmentRenamed(memberIds, oldName, newName) {
  if (!isValidName(newName) || oldName === newName) return;
  await User.updateMany(
    { _id: { $in: memberIds }, Department: oldName },
    { $set: { Department: newName } }
  );
}

async function onDepartmentDeleted(department) {
  for (const member of department.users || []) {
    await onMemberRemoved(member._id, department.name, department._id);
  }
}

// The other direction: an admin set users.Department directly (Users page / user creation).
// Move the membership to match: join the new department's member list (if that department
// exists) and leave the old one, unless the user heads the old one (a head can't be
// removed until a new head is assigned, so they stay listed there).
async function onUserDepartmentSet(user, oldName, newName) {
  if (oldName === newName) return;
  if (newName) {
    await Department.updateOne(
      { name: newName, "users._id": { $ne: user._id } },
      { $push: { users: { _id: user._id, name: user.name } } }
    );
  }
  if (oldName) {
    await Department.updateOne(
      { name: oldName, "headOfDepartment.user": { $ne: user._id } },
      { $pull: { users: { _id: user._id } } }
    );
  }
}

// Department documents keep a copy of member and head names; refresh them after a rename.
async function onUserRenamed(userId, newName) {
  await Department.updateMany({ "users._id": userId }, { $set: { "users.$.name": newName } });
  await Department.updateMany({ "headOfDepartment.user": userId }, { $set: { "headOfDepartment.name": newName } });
}

module.exports = {
  onMemberAdded,
  onMemberRemoved,
  onDepartmentRenamed,
  onDepartmentDeleted,
  onUserDepartmentSet,
  onUserRenamed,
  isValidName,
};
