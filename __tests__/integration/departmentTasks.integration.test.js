/**
 * Department page + task routes — integration tests against a real MongoDB
 * (mongodb-memory-server). Covers the permission checks and the stats fixes.
 * Mocked: Redis sessions only.
 */
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const mockSessions = {};
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(async (k) => mockSessions[k.replace('session:', '')] || null),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

const User = require('../../models/users_');
const Department = require('../../models/Department');
const Task = require('../../models/tasks');
const departmentRoutes = require('../../routes/v1/Department_route');
const taskRoutes = require('../../routes/v1/task');
const accessRoutes = require('../../routes/v1/access');

let mongo;
let admin, head, otherHead, staff, staff2, outsider;
let dept, otherDept;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/department', departmentRoutes);
  a.use('/api/tasks', taskRoutes);
  a.use('/api/access', accessRoutes);
  return a;
};

const login = (user) => {
  const sid = `sid-${user._id}`;
  mockSessions[sid] = JSON.stringify({ userId: String(user._id), role: user.role, name: user.name });
  return [`sessionId=${sid}`];
};

const mkUser = (name, role = 'staff') =>
  User.create({ name, email: `${name.toLowerCase().replace(/\s/g, '')}@test.com`, password: 'hash', role });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Department.deleteMany({}), Task.deleteMany({})]);
  admin = await mkUser('Admin User', 'global_admin');
  head = await mkUser('Head User', 'procurement_officer');
  otherHead = await mkUser('Other Head', 'Accountant');
  staff = await mkUser('Staff One');
  staff2 = await mkUser('Staff Two');
  outsider = await mkUser('Outsider');
  dept = await Department.create({
    name: 'Procurement_department',
    headOfDepartment: { user: head._id, name: head.name },
    users: [{ _id: head._id, name: head.name }, { _id: staff._id, name: staff.name }, { _id: staff2._id, name: staff2.name }],
  });
  otherDept = await Department.create({
    name: 'accounts_dep',
    headOfDepartment: { user: otherHead._id, name: otherHead.name },
    users: [{ _id: otherHead._id, name: otherHead.name }, { _id: outsider._id, name: outsider.name }],
  });
});

const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

describe('tasks', () => {
  it('head assigns a task to a member; createdBy comes from the session', async () => {
    const res = await request(app()).post('/api/tasks').set('Cookie', login(head)).send({
      title: 'Get supplier quotes', assignedTo: staff._id, department: dept._id,
      dueDate: tomorrow(), createdBy: admin._id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.createdBy.name).toBe('Head User');
    expect(res.body.data.status).toBe('Pending');
  });

  it('head cannot assign tasks in another department', async () => {
    const res = await request(app()).post('/api/tasks').set('Cookie', login(head)).send({
      title: 'x', assignedTo: outsider._id, department: otherDept._id, dueDate: tomorrow(),
    });
    expect(res.status).toBe(403);
  });

  it('staff cannot assign tasks', async () => {
    const res = await request(app()).post('/api/tasks').set('Cookie', login(staff)).send({
      title: 'x', assignedTo: staff2._id, department: dept._id, dueDate: tomorrow(),
    });
    expect(res.status).toBe(403);
  });

  it('assignee must be a member of the department', async () => {
    const res = await request(app()).post('/api/tasks').set('Cookie', login(head)).send({
      title: 'x', assignedTo: outsider._id, department: dept._id, dueDate: tomorrow(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid status values such as "InProgress"', async () => {
    const res = await request(app()).post('/api/tasks').set('Cookie', login(head)).send({
      title: 'x', assignedTo: staff._id, department: dept._id, dueDate: tomorrow(), status: 'InProgress',
    });
    expect(res.status).toBe(400);
  });

  it('task lists are scoped and never include password hashes', async () => {
    await Task.create({ title: 'A', assignedTo: staff._id, department: dept._id, dueDate: tomorrow() });
    await Task.create({ title: 'B', assignedTo: staff2._id, department: dept._id, dueDate: tomorrow() });
    await Task.create({ title: 'C', assignedTo: outsider._id, department: otherDept._id, dueDate: tomorrow() });

    const mine = await request(app()).get('/api/tasks').set('Cookie', login(staff));
    expect(mine.body.data.map((t) => t.title)).toEqual(['A']);

    const team = await request(app()).get('/api/tasks').set('Cookie', login(head));
    expect(team.body.data.map((t) => t.title).sort()).toEqual(['A', 'B']);

    const all = await request(app()).get('/api/tasks').set('Cookie', login(admin));
    expect(all.body.data).toHaveLength(3);
    expect(JSON.stringify(all.body)).not.toContain('"password"');
  });

  it("only the user, admins or their head can read a user's tasks", async () => {
    await Task.create({ title: 'A', assignedTo: staff._id, department: dept._id, dueDate: tomorrow() });
    expect((await request(app()).get(`/api/tasks/${staff._id}`).set('Cookie', login(staff))).status).toBe(200);
    expect((await request(app()).get(`/api/tasks/${staff._id}`).set('Cookie', login(head))).status).toBe(200);
    expect((await request(app()).get(`/api/tasks/${staff._id}`).set('Cookie', login(staff2))).status).toBe(403);
    expect((await request(app()).get(`/api/tasks/${staff._id}`).set('Cookie', login(otherHead))).status).toBe(403);
  });

  it('assignee can complete their task (sets completedAt); other staff cannot', async () => {
    const t = await Task.create({ title: 'A', assignedTo: staff._id, department: dept._id, dueDate: tomorrow() });
    const denied = await request(app()).patch(`/api/tasks/${t._id}`).set('Cookie', login(staff2)).send({ status: 'Completed' });
    expect(denied.status).toBe(403);

    const ok = await request(app()).patch(`/api/tasks/${t._id}`).set('Cookie', login(staff)).send({ status: 'Completed' });
    expect(ok.status).toBe(200);
    expect((await Task.findById(t._id)).completedAt).toBeInstanceOf(Date);

    await request(app()).patch(`/api/tasks/${t._id}`).set('Cookie', login(staff)).send({ status: 'In Progress' });
    expect((await Task.findById(t._id)).completedAt).toBeNull();
  });

  it('delete needs a session and head/admin rights', async () => {
    const t = await Task.create({ title: 'A', assignedTo: staff._id, department: dept._id, dueDate: tomorrow() });
    expect((await request(app()).delete(`/api/tasks/${t._id}`)).status).toBe(401);
    expect((await request(app()).delete(`/api/tasks/${t._id}`).set('Cookie', login(staff))).status).toBe(403);
    expect((await request(app()).delete(`/api/tasks/${t._id}`).set('Cookie', login(head))).status).toBe(200);
  });
});

describe('departments', () => {
  it('heads only see their own department; admins see all', async () => {
    const h = await request(app()).get('/api/department').set('Cookie', login(head));
    expect(h.body.data.map((d) => d.name)).toEqual(['Procurement_department']);
    const a = await request(app()).get('/api/department').set('Cookie', login(admin));
    expect(a.body.data).toHaveLength(2);
  });

  it('GET /:id returns that department, not the whole list', async () => {
    const res = await request(app()).get(`/api/department/${dept._id}`).set('Cookie', login(staff));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Procurement_department');
    expect((await request(app()).get(`/api/department/${otherDept._id}`).set('Cookie', login(staff))).status).toBe(403);
  });

  it('only admins can create, edit or delete departments; createdBy is set', async () => {
    const body = { name: 'IT', headOfDepartment: { user: staff._id } };
    expect((await request(app()).post('/api/department').set('Cookie', login(head)).send(body)).status).toBe(403);
    const res = await request(app()).post('/api/department').set('Cookie', login(admin)).send(body);
    expect(res.status).toBe(201);
    expect(String(res.body.data.createdBy)).toBe(String(admin._id));
    // head is added as a member
    expect(res.body.data.users.map((u) => String(u._id))).toContain(String(staff._id));
    expect((await request(app()).delete(`/api/department/${dept._id}`).set('Cookie', login(head))).status).toBe(403);
  });

  it('head can add members, but not duplicates or to other departments', async () => {
    const add = await request(app()).post(`/api/department/${dept._id}/users`).set('Cookie', login(head)).send({ userId: outsider._id });
    expect(add.status).toBe(200);
    const dup = await request(app()).post(`/api/department/${dept._id}/users`).set('Cookie', login(head)).send({ userId: outsider._id });
    expect(dup.status).toBe(400);
    const other = await request(app()).post(`/api/department/${otherDept._id}/users`).set('Cookie', login(head)).send({ userId: staff._id });
    expect(other.status).toBe(403);
  });

  it('cannot remove the head from their own department', async () => {
    const res = await request(app()).delete(`/api/department/${dept._id}/users/${head._id}`).set('Cookie', login(admin));
    expect(res.status).toBe(400);
    const ok = await request(app()).delete(`/api/department/${dept._id}/users/${staff2._id}`).set('Cookie', login(head));
    expect(ok.status).toBe(200);
    expect(ok.body.data.users).toHaveLength(2);
  });

  it('changing the head keeps the { user, name } shape', async () => {
    const res = await request(app()).patch(`/api/department/${dept._id}/head`).set('Cookie', login(admin)).send({ headOfDepartment: String(staff._id) });
    expect(res.status).toBe(200);
    const saved = await Department.findById(dept._id).lean();
    expect(String(saved.headOfDepartment.user)).toBe(String(staff._id));
    expect(saved.headOfDepartment.name).toBe('Staff One');
  });

  it('delete is blocked while the department has open tasks', async () => {
    await Task.create({ title: 'A', assignedTo: staff._id, department: dept._id, dueDate: tomorrow() });
    const res = await request(app()).delete(`/api/department/${dept._id}`).set('Cookie', login(admin));
    expect(res.status).toBe(409);
  });

  it('stats count open, overdue and completed tasks correctly and are scoped', async () => {
    const created = new Date(Date.now() - 4 * 86400000);
    await Task.collection.insertMany([
      { title: 'open', status: 'Pending', department: dept._id, assignedTo: staff._id, dueDate: new Date(Date.now() + 86400000), createdAt: created, updatedAt: created },
      { title: 'late', status: 'In Progress', department: dept._id, assignedTo: staff._id, dueDate: new Date(Date.now() - 86400000), createdAt: created, updatedAt: created },
      { title: 'done', status: 'Completed', department: dept._id, assignedTo: staff._id, dueDate: new Date(), createdAt: created, updatedAt: new Date(), completedAt: new Date(created.getTime() + 2 * 86400000) },
    ]);

    const res = await request(app()).get('/api/department/stats').set('Cookie', login(head));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const s = res.body.data[0];
    expect(s.memberCount).toBe(3);
    expect(s.totalTasks).toBe(3);
    expect(s.activeTasks).toBe(2);
    expect(s.overdueTasks).toBe(1);
    expect(s.taskCompletion).toBe(33);
    expect(s.avgCompletionDays).toBe(2);
  });
});

describe('access', () => {
  it('flags heads of department', async () => {
    expect((await request(app()).get('/api/access').set('Cookie', login(head))).body.user.isHeadOfDepartment).toBe(true);
    expect((await request(app()).get('/api/access').set('Cookie', login(staff))).body.user.isHeadOfDepartment).toBe(false);
  });
});
