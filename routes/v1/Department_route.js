const express = require("express");
const mongoose = require("mongoose");
const auth = require("../../middlewares/check-auth");
const Department = require("../../models/Department");
const Task = require("../../models/tasks");
const User = require("../../models/users_");
const { body, validationResult } = require("express-validator");
const {
  isDepartmentAdmin,
  headedDepartmentIds,
  canManageDepartment,
  isHeadOf,
  isMember,
} = require("../../services/departmentAccess");
const membership = require("../../services/departmentMembership");

const router = express.Router();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const requireDepartmentAdmin = (req, res, next) => {
  if (!isDepartmentAdmin(req.user)) {
    return res.status(403).json({ success: false, message: "Only HR or admins can do this" });
  }
  next();
};

// Loads :id into req.department and checks the caller may manage it
// (department-admin role, or head of this department).
const loadManagedDepartment = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid department id" });
    }
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }
    if (!canManageDepartment(req.user, department)) {
      return res.status(403).json({ success: false, message: "You do not manage this department" });
    }
    req.department = department;
    next();
  } catch (error) {
    console.error("Error loading department:", error);
    res.status(500).json({ success: false, message: "Server error loading department" });
  }
};

// Admins see every department; everyone else sees the departments they head.
async function visibleDepartmentFilter(user) {
  if (isDepartmentAdmin(user)) return {};
  const ids = await headedDepartmentIds(user?.userId);
  return { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } };
}

// Get departments
router.get("/", auth, async (req, res) => {
  try {
    const filter = await visibleDepartmentFilter(req.user);
    const departments = await Department.find(filter)
      .populate("headOfDepartment.user", "name email role");

    res.status(200).json({ success: true, count: departments.length, data: departments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error retrieving departments" });
  }
});

// Department statistics
router.get("/stats", auth, async (req, res) => {
  try {
    const filter = await visibleDepartmentFilter(req.user);
    const completedOnly = {
      $filter: { input: "$tasks", as: "t", cond: { $eq: ["$$t.status", "Completed"] } },
    };
    const openOnly = {
      $filter: { input: "$tasks", as: "t", cond: { $ne: ["$$t.status", "Completed"] } },
    };

    const stats = await Department.aggregate([
      { $match: filter },
      { $lookup: { from: "tasks", localField: "_id", foreignField: "department", as: "tasks" } },
      {
        $project: {
          _id: 1,
          name: 1,
          memberCount: { $size: { $ifNull: ["$users", []] } },
          totalTasks: { $size: "$tasks" },
          activeTasks: { $size: openOnly },
          completedTasks: { $size: completedOnly },
          overdueTasks: {
            $size: {
              $filter: {
                input: "$tasks",
                as: "t",
                cond: {
                  $and: [
                    { $ne: ["$$t.status", "Completed"] },
                    { $ne: [{ $ifNull: ["$$t.dueDate", null] }, null] },
                    { $lt: ["$$t.dueDate", "$$NOW"] },
                  ],
                },
              },
            },
          },
          // Days from creation to completion. completedAt is new; older tasks fall back to updatedAt.
          avgCompletionDays: {
            $avg: {
              $map: {
                input: completedOnly,
                as: "t",
                in: {
                  $divide: [
                    { $subtract: [{ $ifNull: ["$$t.completedAt", "$$t.updatedAt"] }, "$$t.createdAt"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          taskCompletion: {
            $cond: [
              { $gt: ["$totalTasks", 0] },
              { $round: [{ $multiply: [{ $divide: ["$completedTasks", "$totalTasks"] }, 100] }, 0] },
              0,
            ],
          },
          avgCompletionDays: {
            $cond: [{ $eq: ["$avgCompletionDays", null] }, null, { $round: ["$avgCompletionDays", 1] }],
          },
        },
      },
    ]);

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.error("Error fetching department stats:", err);
    res.status(500).json({ success: false, message: "Error fetching stats" });
  }
});

// Get single department (admins, its head, or its members)
router.get("/:id", auth, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid department id" });
    }
    const department = await Department.findById(req.params.id)
      .populate("headOfDepartment.user", "name email role");

    if (!department) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }
    if (!canManageDepartment(req.user, department) && !isMember(department, req.user?.userId)) {
      return res.status(403).json({ success: false, message: "You do not have access to this department" });
    }

    res.status(200).json({ success: true, data: department });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error retrieving department" });
  }
});

// Create department (department admins only)
router.post(
  "/",
  auth,
  requireDepartmentAdmin,
  [
    body("name").notEmpty().withMessage("Department name is required"),
    body("headOfDepartment.user")
      .notEmpty().withMessage("Head of department is required")
      .bail()
      .isMongoId().withMessage("Invalid head of department"),
    body("users").optional().isArray().withMessage("Users must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, users = [], headOfDepartment } = req.body;

      if (await Department.findOne({ name })) {
        return res.status(400).json({ success: false, message: "Department already exists" });
      }

      const head = await User.findById(headOfDepartment.user).select("name");
      if (!head) {
        return res.status(404).json({ success: false, message: "Head of department not found" });
      }

      // The head is always a member of their own department
      const members = users
        .filter((m) => m && isValidId(m._id))
        .map((m) => ({ _id: m._id, name: m.name }));
      if (!members.some((m) => String(m._id) === String(head._id))) {
        members.push({ _id: head._id, name: head.name });
      }

      const department = new Department({
        name,
        users: members,
        headOfDepartment: { user: head._id, name: head.name },
        createdBy: req.user.userId,
      });
      await department.save();
      await Promise.all(members.map((m) => membership.onMemberAdded(m._id, department.name)));

      res.status(201).json({ success: true, data: department });
    } catch (error) {
      console.error("Error creating department:", error);
      res.status(500).json({
        success: false,
        message: "Server error creating department",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

// Update department name / head (department admins only)
router.put("/:id", auth, requireDepartmentAdmin, loadManagedDepartment, async (req, res) => {
  try {
    const department = req.department;
    const { name, headOfDepartment } = req.body;
    const oldName = department.name;
    let addedHeadId = null;

    if (name && name !== department.name) {
      if (await Department.findOne({ name })) {
        return res.status(400).json({ success: false, message: "Department with this name already exists" });
      }
      department.name = name;
    }

    const newHeadId = headOfDepartment?.user;
    if (newHeadId && String(newHeadId) !== String(department.headOfDepartment?.user)) {
      if (!isValidId(newHeadId)) {
        return res.status(400).json({ success: false, message: "Invalid head of department" });
      }
      const head = await User.findById(newHeadId).select("name");
      if (!head) {
        return res.status(404).json({ success: false, message: "Head of department not found" });
      }
      department.headOfDepartment = { user: head._id, name: head.name };
      if (!isMember(department, head._id)) {
        department.users.push({ _id: head._id, name: head.name });
        addedHeadId = head._id;
      }
    }

    await department.save();
    if (department.name !== oldName) {
      await membership.onDepartmentRenamed(department.users.map((m) => m._id), oldName, department.name);
    }
    if (addedHeadId) await membership.onMemberAdded(addedHeadId, department.name);
    const populated = await Department.findById(department._id)
      .populate("headOfDepartment.user", "name email role");

    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error updating department:", error);
    res.status(500).json({ success: false, message: "Error updating department" });
  }
});

// Delete department (department admins only). Blocked while it has open tasks,
// so no assigned work is left pointing at a department that no longer exists.
router.delete("/:id", auth, requireDepartmentAdmin, loadManagedDepartment, async (req, res) => {
  try {
    const openTasks = await Task.countDocuments({
      department: req.department._id,
      status: { $ne: "Completed" },
    });
    if (openTasks > 0) {
      return res.status(409).json({
        success: false,
        message: `This department still has ${openTasks} open task(s). Complete, reassign or delete them first.`,
      });
    }

    await req.department.deleteOne();
    await membership.onDepartmentDeleted(req.department);
    res.status(200).json({ success: true, message: "Department deleted successfully" });
  } catch (error) {
    console.error("Error deleting department:", error);
    res.status(500).json({ success: false, message: "Error deleting department" });
  }
});

// Add user to department (admins or this department's head)
router.post("/:id/users", auth, loadManagedDepartment, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!isValidId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const department = req.department;
    if (isMember(department, userId)) {
      return res.status(400).json({ success: false, message: "User already in department" });
    }

    const newUser = await User.findById(userId).select("name");
    if (!newUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    department.users.push({ _id: newUser._id, name: newUser.name });
    await department.save();
    await membership.onMemberAdded(newUser._id, department.name);
    const populated = await Department.findById(department._id)
      .populate("headOfDepartment.user", "name email role");

    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error adding user to department:", error);
    res.status(500).json({ success: false, message: "Error adding user to department" });
  }
});

// Remove user from department (admins or this department's head)
router.delete("/:id/users/:userId", auth, loadManagedDepartment, async (req, res) => {
  try {
    const department = req.department;
    const { userId } = req.params;

    if (isHeadOf(department, userId)) {
      return res.status(400).json({
        success: false,
        message: "This user is the head of department. Assign a new head before removing them.",
      });
    }
    if (!isMember(department, userId)) {
      return res.status(404).json({ success: false, message: "User is not in this department" });
    }

    department.users = department.users.filter((m) => String(m._id) !== String(userId));
    await department.save();
    await membership.onMemberRemoved(userId, department.name, department._id);
    const populated = await Department.findById(department._id)
      .populate("headOfDepartment.user", "name email role");

    res.status(200).json({ success: true, data: populated });
  } catch (error) {
    console.error("Error removing user from department:", error);
    res.status(500).json({ success: false, message: "Error removing user from department" });
  }
});

// Assign / change head of department (department admins only)
router.patch(
  "/:id/head",
  auth,
  requireDepartmentAdmin,
  [
    body("headOfDepartment")
      .notEmpty().withMessage("Head of department ID is required")
      .bail()
      .isMongoId().withMessage("Invalid user ID format"),
  ],
  loadManagedDepartment,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const department = req.department;
      const { headOfDepartment } = req.body;

      const user = await User.findById(headOfDepartment).select("name");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      if (isHeadOf(department, headOfDepartment)) {
        return res.status(400).json({ success: false, message: "User is already head of this department" });
      }
      if (!isMember(department, headOfDepartment)) {
        return res.status(400).json({ success: false, message: "User must be a department member first" });
      }

      department.headOfDepartment = { user: user._id, name: user.name };
      await department.save();

      const populated = await Department.findById(department._id)
        .populate("headOfDepartment.user", "name email role");

      res.status(200).json({ success: true, message: "Head of department updated successfully", data: populated });
    } catch (error) {
      console.error("Error assigning head:", error);
      res.status(500).json({ success: false, message: "Error assigning head of department" });
    }
  }
);

module.exports = router;
