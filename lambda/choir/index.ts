import * as AWS from 'aws-sdk';
import * as crypto from 'crypto';

const s3 = process.env.S3_ENDPOINT ? new AWS.S3({ endpoint: process.env.S3_ENDPOINT, s3ForcePathStyle: true }) : new AWS.S3();

export interface Performance {
  id: string;
  status: string;
  version: number;
  leaderId?: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  startTime?: number | null;
  participantCount: number;
}

const createIdle = (now = Date.now()): Performance => ({
  id: 'current',
  status: 'IDLE',
  version: 0,
  leaderId: null,
  createdAt: now,
  updatedAt: now,
  expiresAt: 0,
  startTime: null,
  participantCount: 0,
});

export async function readPerformance(bucket: string, key: string) {
  try {
    const data = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    const bodyStr = data.Body ? data.Body.toString() : '{}';
    const obj = JSON.parse(bodyStr);
    return { obj: obj as Performance, eTag: data.ETag };
  } catch (err: any) {
    if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
      return { obj: createIdle(), eTag: undefined };
    }
    throw err;
  }
}

// Use copy-if-match strategy: upload temp, then copy onto key using IfMatch with prior ETag
export async function writePerformance(bucket: string, key: string, buildFn: (cur: Performance, now: number) => Performance, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { obj: current, eTag } = await readPerformance(bucket, key);
    const now = Date.now();
    const candidate = buildFn(current, now);
    candidate.version = (current.version || 0) + 1;
    candidate.updatedAt = now;
    if (!candidate.createdAt) candidate.createdAt = current.createdAt || now;

    // If there is no existing ETag (object missing), do a simple putObject
    if (!eTag) {
      await s3.putObject({ Bucket: bucket, Key: key, Body: JSON.stringify(candidate), ContentType: 'application/json', CacheControl: 'no-store' }).promise();
      const after = await readPerformance(bucket, key);
      if (after.obj.version === candidate.version) return { success: true, performance: candidate };
      continue;
    }
    const tmpKey = `${key}.tmp.${crypto.randomBytes(8).toString('hex')}`;
    await s3.putObject({ Bucket: bucket, Key: tmpKey, Body: JSON.stringify(candidate), ContentType: 'application/json', CacheControl: 'no-store' }).promise();

    try {
      await s3.copyObject({
        Bucket: bucket,
        Key: key,
        CopySource: encodeURIComponent(`${bucket}/${tmpKey}`),
        CopySourceIfMatch: eTag.replace(/"/g, ''),
        MetadataDirective: 'REPLACE',
        ContentType: 'application/json',
        CacheControl: 'no-store',
      }).promise();

      await s3.deleteObject({ Bucket: bucket, Key: tmpKey }).promise();

      const after = await readPerformance(bucket, key);
      if (after.obj.version === candidate.version) return { success: true, performance: candidate };
    } catch (err: any) {
      if (err.code === 'PreconditionFailed' || err.statusCode === 412) {
        await s3.deleteObject({ Bucket: bucket, Key: tmpKey }).promise();
        continue;
      }
      await s3.deleteObject({ Bucket: bucket, Key: tmpKey }).promise();
      throw err;
    }
  }

  const latest = await readPerformance(bucket, key);
  return { success: false, performance: latest.obj };
}

function randomId() {
  if ((crypto as any).randomUUID) return (crypto as any).randomUUID();
  return crypto.randomBytes(8).toString('hex');
}

export const handler = async (event: any) => {
  const bucket = process.env.BUCKET!;
  const key = process.env.KEY || 'performance/current.json';

  try {
    if (event.httpMethod === 'GET') {
      const { obj } = await readPerformance(bucket, key);
      const now = Date.now();
      if (obj.expiresAt && obj.expiresAt > 0 && now > obj.expiresAt) {
        const idle = createIdle(now);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify(idle),
        };
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
    }

    if (event.httpMethod === 'POST') {
      const path = event.path || '';
      const now = Date.now();

      if (path.endsWith('/claim')) {
        const res = await writePerformance(bucket, key, (cur, now) => {
          const expired = cur.expiresAt && cur.expiresAt > 0 && now > cur.expiresAt;
          if (cur.status === 'IDLE' || expired) {
            return { id: 'current', status: 'READY', leaderId: randomId(), participantCount: 0, expiresAt: now + 60 * 60 * 1000 } as Performance;
          }
          return cur;
        });

        if (!res.success) return { statusCode: 409, body: JSON.stringify(res.performance) };
        return { statusCode: 200, body: JSON.stringify(res.performance) };
      }

      if (path.endsWith('/join')) {
        const res = await writePerformance(bucket, key, (cur) => {
          if (cur.status === 'READY') return { ...cur, participantCount: (cur.participantCount || 0) + 1 } as Performance;
          return cur;
        });

        if (!res.success) return { statusCode: 409, body: JSON.stringify(res.performance) };
        return { statusCode: 200, body: JSON.stringify(res.performance) };
      }

      if (path.endsWith('/start')) {
        const body = event.body ? JSON.parse(event.body) : {};
        const res = await writePerformance(bucket, key, (cur, now) => {
          if (cur.status === 'READY' && body.leaderId && body.leaderId === cur.leaderId) {
            return { ...cur, status: 'PLAYING', startTime: now + 2000, expiresAt: now + 60 * 60 * 1000 } as Performance;
          }
          return cur;
        });

        if (!res.success) return { statusCode: 403, body: JSON.stringify(res.performance) };
        return { statusCode: 200, body: JSON.stringify(res.performance) };
      }

      if (path.endsWith('/reset')) {
        const body = event.body ? JSON.parse(event.body) : {};
        const res = await writePerformance(bucket, key, (cur, now) => {
          const expired = cur.expiresAt && cur.expiresAt > 0 && now > cur.expiresAt;
          if ((body.leaderId && body.leaderId === cur.leaderId) || expired) return createIdle(now);
          return cur;
        });

        if (!res.success) return { statusCode: 409, body: JSON.stringify(res.performance) };
        return { statusCode: 200, body: JSON.stringify(res.performance) };
      }
    }

    return { statusCode: 404, body: 'Not found' };
  } catch (err) {
    console.error('Handler error', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
