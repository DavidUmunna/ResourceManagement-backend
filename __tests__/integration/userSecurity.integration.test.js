/**
 * Users list access, password hiding, the legacy /api/signin check, and
 * keeping users.Department in step with department membership.
 * Real MongoDB (mongodb-memory-server); Redis sessions and bcrypt are mocked
 * (bcrypt's native build doesn't load on every machine).
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
  set:     jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));
jest.mock('bcrypt', () => ({
  hash:    jest.fn(async (pw) => `hashed:${pw}`),
  compare: jest.fn(async (pw, hash) => hash === `hashed:${pw}`),
}));
jest.mock('../../emailnotification/emailNotification', () => ({ transporter: { sendMail: jest.fn() } }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../../models/users_');
const Department = require('../../models/Department');
const usersRoutes = require('../../routes/v1/users');
const signinRoutes = require('../../routes/v1/signin');
const departmentRoutes = require('../../routes/v1/Department_route');
const { buildReport } = require('../../maintenanceScripts/departmentMismatchReport');

let mongo;
let admin, director, head, staff, other;
let procurement, accounts;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/users', usersRoutes);
  a.use('/api/signin', signinRoutes);
  a.use('/api/department', departmentRoutes);
  return a;
};

const login = (user) => {
  const sid = `sid-${user._id}`;
  mockSessions[sid] = JSON.stringify({ userId: String(user._id), role: user.role, name: user.name });
  return [`sessionId=${sid}`];
};

const mkUser = (name, role = 'staff', Department) =>
  User.create({ name, email: `${name.toLowerCase().replace(/\s/g, '')}@test.com`, password: 'hashed:secret', role, Department });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Department.deleteMany({})]);
  admin = await mkUser('Admin User', 'global_admin');
  director = await mkUser('Dee Director', 'Director');
  head = await mkUser('Head User', 'procurement_officer', 'Procurement_department');
  staff = await mkUser('Staff One', 'staff', 'Procurement_department');
  other = await mkUser('Other Person', 'staff', 'accounts_dep');
  procurement = await Department.create({
    name: 'Procurement_department',
    headOfDepartment: { user: head._id, name: head.name },
    users: [{ _id: head._id, name: head.name }, { _id: staff._id, name: staff.name }],
  });
  accounts = await Department.create({
    name: 'accounts_dep',
    headOfDepartment: { user: other._id, name: other.name },
    users: [{ _id: other._id, name: other.name }],
  });
});

describe('password hashes are never returned', () => {
  it('plain queries leave the password out; login can still ask for it', async () => {
    const plain = await User.findById(staff._id).lean();
    expect(plain.password).toBeUndefined();
    const forLogin = await User.findOne({ email: staff.email }, '+password').lean();
    expect(forLogin.password).toBe('hashed:secret');
  });

  it('admin password changes on the Users page are actually saved', async () => {
    const res = await request(app()).put(`/api/users/${staff._id}/updateuser`).set('Cookie', login(admin)).send({ password: 'newpass' });
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    const saved = await User.findById(staff._id).select('+password').lean();
    expect(saved.password).toBe('hashed:newpass');
  });
});

describe('GET /api/users', () => {
  it('needs a login', async () => {
    expect((await request(app()).get('/api/users')).status).toBe(401);
  });

  it('is refused for ordinary staff', async () => {
    expect((await request(app()).get('/api/users').set('Cookie', login(staff))).status).toBe(403);
  });

  it('heads of department get names only', async () => {
    const res = await request(app()).get('/api/users').set('Cookie', login(head));
    expect(res.status).toBe(200);
    const one = res.body.data[0];
    expect(Object.keys(one).sort()).toEqual(['_id', 'id', 'name'].filter((k) => k in one).sort());
    expect(one.email).toBeUndefined();
  });

  it('admins and the Director get full details, without secrets', async () => {
    for (const u of [admin, director]) {
      const res = await request(app()).get('/api/users').set('Cookie', login(u));
      expect(res.status).toBe(200);
      expect(res.body.data[0].email).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain('"password"');
    }
  });
});

describe('legacy POST /api/signin', () => {
  it("rejects someone else's password hash used as the password", async () => {
    await User.updateOne({ _id: other._id }, { $set: { password: 'hashed:otherpw' } });
    const res = await request(app()).post('/api/signin').send({ username: staff.email, password: 'hashed:otherpw' });
    expect(res.status).toBe(401);
  });

  it('accepts the right password', async () => {
    const res = await request(app()).post('/api/signin').send({ username: staff.email, password: 'secret' });
    expect(res.status).not.toBe(401);
  });
});

describe('users.Department follows department membership', () => {
  it('joining a department sets users.Department', async () => {
    await request(app()).post(`/api/department/${procurement._id}/users`).set('Cookie', login(admin)).send({ userId: other._id });
    expect((await User.findById(other._id).lean()).Department).toBe('Procurement_department');
  });

  it('leaving falls back to another membership, else clears it', async () => {
    // other is in accounts; add to procurement (now home), then remove → back to accounts
    await request(app()).post(`/api/department/${procurement._id}/users`).set('Cookie', login(admin)).send({ userId: other._id });
    await request(app()).delete(`/api/department/${procurement._id}/users/${other._id}`).set('Cookie', login(admin));
    expect((await User.findById(other._id).lean()).Department).toBe('accounts_dep');

    await request(app()).delete(`/api/department/${procurement._id}/users/${staff._id}`).set('Cookie', login(head));
    expect((await User.findById(staff._id).lean()).Department).toBeUndefined();
  });

  it('renaming a department updates its members', async () => {
    await request(app()).put(`/api/department/${procurement._id}`).set('Cookie', login(admin)).send({ name: 'IT' });
    expect((await User.findById(staff._id).lean()).Department).toBe('IT');
    expect((await User.findById(other._id).lean()).Department).toBe('accounts_dep');
  });

  it('changing users.Department on the Users page moves the membership', async () => {
    await request(app()).put(`/api/users/${staff._id}/updateuser`).set('Cookie', login(admin)).send({ Department: 'accounts_dep' });
    const [p, a] = await Promise.all([Department.findById(procurement._id).lean(), Department.findById(accounts._id).lean()]);
    expect(p.users.map((m) => String(m._id))).not.toContain(String(staff._id));
    expect(a.users.map((m) => String(m._id))).toContain(String(staff._id));
  });

  it('renaming a user refreshes the names stored on departments', async () => {
    await request(app()).put(`/api/users/${head._id}/updateuser`).set('Cookie', login(admin)).send({ name: 'Head Renamed' });
    const p = await Department.findById(procurement._id).lean();
    expect(p.headOfDepartment.name).toBe('Head Renamed');
    expect(p.users.find((m) => String(m._id) === String(head._id)).name).toBe('Head Renamed');
  });

  it('the mismatch report finds drift and multi-department users', async () => {
    await User.updateOne({ _id: staff._id }, { $set: { Department: 'IT' } });
    await Department.updateOne({ _id: accounts._id }, { $push: { users: { _id: head._id, name: head.name } } });
    const { rows } = await buildReport();
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(byEmail[staff.email].fixTo).toBe('Procurement_department');
    expect(byEmail[head.email].issue).toMatch(/several departments/);
    expect(byEmail[head.email].fixTo).toBeNull();
  });
});
