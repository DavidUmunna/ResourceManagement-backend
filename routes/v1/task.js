const express = require("express");
const mongoose = require("mongoose");
const Task = require("../../models/tasks");
const Department = require("../../models/Department");
const auth = require("../../middlewares/check-auth");
const { TASK_STATUSES } = require("../../constants/department.constants");
const {
  isDepartmentAdmin,
  headedDepartmentIds,
  canManageDepartment,
  isMember,
} = require("../../services/departmentAccess");

const router = express.Router();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// The user schema marks password with select:true, so mongoose adds it to every
// populate even when we only ask for name/email. Strip it before responding.
const stripUserSecrets = (u) => {
  if (!u || typeof u !== "object") return u;
  const { password, resetToken, resetTokenExpiration, NotificationToken, ...safe } = u;
  return safe;
};
const sanitize = (t) =>
  t && { ...t, assignedTo: stripUserSecrets(t.assignedTo), createdBy: stripUserSecrets(t.createdBy) };

// Populated, lean, and safe to send to the browser. Resolves to one task or an array.
const withRefs = async (query) => {
  const result = await query
    .populate("assignedTo", "name email")
    .populate("department", "name")
    .populate("createdBy", "name")
    .lean();
  return Array.isArray(result) ? result.map(sanitize) : sanitize(result);
};

// Loads :id into req.task and checks the caller may change it.
// allowAssignee: the assignee may update status but not delete.
const loadTask = (allowAssignee) => async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const userId = String(req.user?.userId);
    const isAssignee = String(task.assignedTo) === userId;
    let allowed = isDepartmentAdmin(req.user) || (allowAssignee && isAssignee);
    if (!allowed && task.department) {
      const department = await Department.findById(task.department).select("headOfDepartment").lean();
      allowed = canManageDepartment(req.user, department);
    }
    if (!allowed) {
      return res.status(403).json({ success: false, message: "You cannot change this task" });
    }

    req.task = task;
    next();
  } catch (err) {
    console.error("Error loading task:", err);
    res.status(500).json({ success: false, message: "Error loading task" });
  }
};

// Create a task (department admins, or the head of the task's department)
router.post("/", auth, async (req, res) => {
  try {
    const { title, description, assignedTo, department, dueDate } = req.body;
    const status = req.body.status || "Pending";

    if (!title?.trim() || !assignedTo || !department || !dueDate) {
      return res.status(400).json({ success: false, message: "Title, assignee, department and due date are required" });
    }
    if (!isValidId(assignedTo) || !isValidId(department)) {
      return res.status(400).json({ success: false, message: "Invalid assignee or department" });
    }
    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${TASK_STATUSES.join(", ")}` });
    }
    if (Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ success: false, message: "Invalid due date" });
    }

    const dept = await Department.findById(department);
    if (!dept) {
      return res.status(404).json({ success: false, message: "Department not found" });
    }
    if (!canManageDepartment(req.user, dept)) {
      return res.status(403).json({ success: false, message: "Only HR, admins or the head of this department can assign tasks" });
    }
    if (!isMember(dept, assignedTo)) {
      return res.status(400).json({ success: false, message: "The assignee must be a member of this department" });
    }

    const task = await Task.create({
      title: title.trim(),
      description,
      assignedTo,
      department,
      dueDate,
      status,
      completedAt: status === "Completed" ? new Date() : null,
      createdBy: req.user.userId, // always the logged-in user, never trusted from the body
    });

    const populated = await withRefs(Task.findById(task._id));
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    console.error("error from tasks:", err);
    res.status(500).json({ success: false, message: "Error creating task" });
  }
});

// List tasks: admins see all; heads see their departments' tasks plus their own; staff see their own
router.get("/", auth, async (req, res) => {
  try {
    let filter = {};
    if (!isDepartmentAdmin(req.user)) {
      const headed = await headedDepartmentIds(req.user?.userId);
      filter = {
        $or: [
          { assignedTo: req.user?.userId },
          { department: { $in: headed.map((id) => new mongoose.Types.ObjectId(id)) } },
        ],
      };
    }
    const tasks = await withRefs(Task.find(filter).sort({ dueDate: 1 }));
    res.json({ success: true, data: tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching tasks" });
  }
});

// Tasks assigned to one user (that user, admins, or the head of a department they belong to)
router.get("/:id", auth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (!isValidId(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    let allowed = String(targetId) === String(req.user?.userId) || isDepartmentAdmin(req.user);
    if (!allowed) {
      allowed = Boolean(
        await Department.exists({ "headOfDepartment.user": req.user?.userId, "users._id": targetId })
      );
    }
    if (!allowed) {
      return res.status(403).json({ success: false, message: "You cannot view this user's tasks" });
    }

    const tasks = await withRefs(Task.find({ assignedTo: targetId }).sort({ dueDate: 1 }));
    res.json({ success: true, data: tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching tasks" });
  }
});

// Update status (assignee, head of the task's department, or admins)
router.patch("/:id", auth, loadTask(true), async (req, res) => {
  try {
    const { status } = req.body;
    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${TASK_STATUSES.join(", ")}` });
    }

    const task = req.task;
    if (status === "Completed" && task.status !== "Completed") task.completedAt = new Date();
    if (status !== "Completed") task.completedAt = null;
    task.status = status;
    await task.save();

    const populated = await withRefs(Task.findById(task._id));
    res.json({ success: true, data: populated });
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(400).json({ success: false, message: "Error updating task" });
  }
});

// Delete (head of the task's department, or admins)
router.delete("/:id", auth, loadTask(false), async (req, res) => {
  try {
    await req.task.deleteOne();
    res.status(200).json({ success: true, message: "task deleted successfully" });
  } catch (err) {
    console.error("error from delete task", err);
    res.status(500).json({ success: false, message: "error deleting task" });
  }
});

module.exports = router;
