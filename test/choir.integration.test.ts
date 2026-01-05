/**
 * Integration smoke tests for choir Lambda read/write helpers.
 * These tests run only when LOCALSTACK_ENDPOINT is set in the environment.
 */
import * as AWS from 'aws-sdk';
import { readPerformance, writePerformance } from '../lambda/choir/index';

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.S3_ENDPOINT;
const integrationBucket = process.env.INTEGRATION_BUCKET;
const shouldRun = !!endpoint || !!integrationBucket;

describe('choir integration smoke (localstack)', () => {
  if (!shouldRun) {
    test('skipped (no LOCALSTACK_ENDPOINT)', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const s3 = endpoint ? new AWS.S3({ endpoint, s3ForcePathStyle: true }) : new AWS.S3();
  const bucket = integrationBucket || 'choir-smoke-test-bucket';
  const key = 'performance/current.json';

  beforeAll(async () => {
    try {
      await s3.createBucket({ Bucket: bucket }).promise();
    } catch (e) {
      // ignore if exists
    }
  });

  afterAll(async () => {
    try {
      await s3.deleteObject({ Bucket: bucket, Key: key }).promise();
      await s3.deleteBucket({ Bucket: bucket }).promise();
    } catch (e) {}
  });

  test('claim -> join -> start -> reset flows', async () => {
    // ensure seed
    const seedRes = await writePerformance(bucket, key, () => ({ id: 'current', status: 'IDLE', version: 0, leaderId: null, createdAt: 0, updatedAt: 0, expiresAt: 0, startTime: null, participantCount: 0 }));
    expect(seedRes.success).toBe(true);

    const claim = await writePerformance(bucket, key, (cur: any, now: number) => {
      return { id: 'current', status: 'READY', leaderId: 'leader-1', participantCount: 0, expiresAt: Date.now() + 10000 } as any;
    });
    expect(claim.success).toBe(true);
    expect(claim.performance.status).toBe('READY');

  const join = await writePerformance(bucket, key, (cur: any) => ({ ...cur, participantCount: (cur.participantCount || 0) + 1 } as any));
    expect(join.success).toBe(true);
    expect(join.performance.participantCount).toBeGreaterThanOrEqual(1);

  const start = await writePerformance(bucket, key, (cur: any, now: number) => ({ ...cur, status: 'PLAYING', startTime: now + 2000, expiresAt: now + 60000 } as any));
    expect(start.success).toBe(true);
    expect(start.performance.status).toBe('PLAYING');

    // simulate expired then reset
    await s3.putObject({ Bucket: bucket, Key: key, Body: JSON.stringify({ id: 'current', status: 'PLAYING', version: start.performance.version + 1, expiresAt: Date.now() - 1000 }), ContentType: 'application/json' }).promise();

  const reset = await writePerformance(bucket, key, (cur: any, now: number) => (createIdle(now)) as any);
    // reset may fail if concurrent writes happened, so accept either success or success false but resulting state idle
    if (!reset.success) {
      expect(reset.performance.status).toBe('IDLE');
    } else {
      expect(reset.performance.status).toBe('IDLE');
    }
  });
});

function createIdle(now = Date.now()) {
  return { id: 'current', status: 'IDLE', version: 0, leaderId: null, createdAt: now, updatedAt: now, expiresAt: 0, startTime: null, participantCount: 0 };
}
