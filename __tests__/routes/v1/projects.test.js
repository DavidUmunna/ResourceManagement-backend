const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get: jest.fn(), expire: jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

jest.mock('../../../repositories/project.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findByCode: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../services/ComplianceLog.service', () => ({ logComplianceAction: jest.fn().mockResolvedValue({}) }));

const projectRepo = require('../../../repositories/project.repository');
const { logComplianceAction } = require('../../../services/ComplianceLog.service');
const router = require('../../../routes/v1/project.routes');

const SESSION = JSON.stringify({ userId: 'u1', role: 'global_admin', name: 'Admin' });
const cookie = ['sessionId=s1'];
function app() { const a = express(); a.use(express.json()); a.use(cookieParser()); a.use('/api/projects', router); return a; }

beforeEach(() => { jest.clearAllMocks(); mockRedisClient.get.mockResolvedValue(SESSION); });

describe('Projects', () => {
  it('creates a project and logs it', async () => {
    projectRepo.findByCode.mockResolvedValue(null);
    projectRepo.create.mockResolvedValue({ _id: 'p1', name: 'Acme Rig 7', code: 'ACME-RIG7' });
    const res = await request(app()).post('/api/projects').set('Cookie', cookie).send({ name: 'Acme Rig 7', code: 'ACME-RIG7' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Acme Rig 7');
    expect(logComplianceAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityType: 'Project' }));
  });

  it('400 without a name', async () => {
    const res = await request(app()).post('/api/projects').set('Cookie', cookie).send({ code: 'X' });
    expect(res.status).toBe(400);
  });

  it('409 on duplicate code', async () => {
    projectRepo.findByCode.mockResolvedValue({ _id: 'pX', code: 'ACME-RIG7' });
    const res = await request(app()).post('/api/projects').set('Cookie', cookie).send({ name: 'Dup', code: 'ACME-RIG7' });
    expect(res.status).toBe(409);
    expect(projectRepo.create).not.toHaveBeenCalled();
  });

  it('lists projects', async () => {
    projectRepo.findAll.mockResolvedValue([{ _id: 'p1', name: 'Acme' }]);
    const res = await request(app()).get('/api/projects').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('404 for a missing project', async () => {
    projectRepo.findById.mockResolvedValue(null);
    const res = await request(app()).get('/api/projects/nope').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('updates a project', async () => {
    projectRepo.findById.mockResolvedValue({ _id: 'p1', name: 'Acme', code: 'A' });
    projectRepo.update.mockResolvedValue({ _id: 'p1', name: 'Acme 2', code: 'A' });
    const res = await request(app()).put('/api/projects/p1').set('Cookie', cookie).send({ name: 'Acme 2' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Acme 2');
  });

  it('401 unauthenticated', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const res = await request(app()).get('/api/projects');
    expect(res.status).toBe(401);
  });
});
