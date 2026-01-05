import { jest } from '@jest/globals';

// Use CommonJS require for the handler (TS lambda)
const AWS = require('aws-sdk');
const s3Mock: any = {
  getObject: jest.fn(),
};

jest.mock('aws-sdk', () => ({ S3: jest.fn(() => s3Mock) }));

const handler = require('../lambda/choir/index.ts').handler;

describe('choir handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BUCKET = 'test-bucket';
    process.env.KEY = 'performance/current.json';
    s3Mock.putObject = jest.fn(() => ({ promise: () => Promise.resolve() }));
    s3Mock.copyObject = jest.fn(() => ({ promise: () => Promise.resolve() }));
    s3Mock.deleteObject = jest.fn(() => ({ promise: () => Promise.resolve() }));
  });

  test('GET returns object from S3', async () => {
    const sample = { id: 'current', status: 'READY', expiresAt: Date.now() + 10000 };
    s3Mock.getObject.mockReturnValue({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });

    const evt = { httpMethod: 'GET' };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('READY');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  test('GET synthesizes IDLE when expired', async () => {
    const sample = { id: 'current', status: 'PLAYING', expiresAt: Date.now() - 1000 };
    s3Mock.getObject.mockReturnValue({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });

    const evt = { httpMethod: 'GET' };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('IDLE');
  });

  test('POST /performance/claim sets READY when IDLE', async () => {
    const sample = { id: 'current', status: 'IDLE', version: 0, expiresAt: 0 };
    // First read returns IDLE
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });
    // After put, get returns the updated object with version 1 (simulates write accepted)
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify({ ...sample, status: 'READY', version: 1 })) }) });

    const evt = { httpMethod: 'POST', path: '/performance/claim' };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('READY');
    expect(body.version).toBe(1);
    expect(body.leaderId).toBeDefined();
  });

  test('POST /performance/join increments participantCount when READY', async () => {
    const sample = { id: 'current', status: 'READY', version: 1, participantCount: 0 };
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify({ ...sample, participantCount: 1, version: 2 })) }) });

    const evt = { httpMethod: 'POST', path: '/performance/join' };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.participantCount).toBe(1);
  });

  test('POST /performance/start validates leaderId', async () => {
    const sample = { id: 'current', status: 'READY', version: 1, leaderId: 'abc' };
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify({ ...sample, status: 'PLAYING', version: 2 })) }) });

    const evt = { httpMethod: 'POST', path: '/performance/start', body: JSON.stringify({ leaderId: 'abc' }) };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('PLAYING');
  });

  test('POST /performance/reset resets when expired', async () => {
    const sample = { id: 'current', status: 'PLAYING', version: 2, expiresAt: Date.now() - 1000 };
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify(sample)) }) });
    s3Mock.getObject.mockReturnValueOnce({ promise: () => Promise.resolve({ Body: Buffer.from(JSON.stringify({ id: 'current', status: 'IDLE', version: 3 })) }) });

    const evt = { httpMethod: 'POST', path: '/performance/reset', body: JSON.stringify({}) };
    const res = await handler(evt);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('IDLE');
  });
});
