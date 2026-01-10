import * as crypto from 'crypto';
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = process.env.S3_ENDPOINT
  ? new S3Client({ endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, region: process.env.AWS_REGION || 'us-east-1' })
  : new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

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
  nextVoiceIndex?: number;
  lastAssignedVoice?: string | null;
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
  nextVoiceIndex: 0,
  lastAssignedVoice: null,
});

export async function readPerformance(bucket: string, key: string) {
  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = data.Body;
    let bodyStr = '{}';
    if (!body) bodyStr = '{}';
    else if (typeof body === 'string') bodyStr = body;
    else if (Buffer.isBuffer(body)) bodyStr = body.toString();
    else {
      bodyStr = await streamToString(body as any);
    }
    const obj = JSON.parse(bodyStr);
    return { obj: obj as Performance, eTag: data.ETag };
  } catch (err: any) {
    const code = err && (err.code || err.Code || err.name || (err.$metadata && err.$metadata.httpStatusCode && String(err.$metadata.httpStatusCode)));
    if (code === 'NoSuchKey' || code === 'NotFound' || code === '404' || (err && /no such key/i.test(String(err.message || '')))) {
      return { obj: createIdle(), eTag: undefined };
    }
    throw err;
  }
}

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err: any) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// Use copy-if-match strategy: upload temp, then copy onto key using IfMatch with prior ETag
export async function writePerformance(bucket: string, key: string, buildFn: (cur: Performance, now: number) => Performance, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { obj: current, eTag } = await readPerformance(bucket, key);
    console.log(`writePerformance attempt=${attempt} readETag=${eTag}`);
    const now = Date.now();
    const candidate = buildFn(current, now);
    candidate.version = (current.version || 0) + 1;
    candidate.updatedAt = now;
    if (!candidate.createdAt) candidate.createdAt = current.createdAt || now;

    // If there is no existing ETag (object missing), do a simple putObject
    if (!eTag) {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(candidate), ContentType: 'application/json', CacheControl: 'no-store' }));
      const after = await readPerformance(bucket, key);
      if (after.obj.version === candidate.version) return { success: true, performance: candidate };
      continue;
    }
  // Attempt a direct put to the key and verify it took effect (best-effort optimistic write)
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(candidate), ContentType: 'application/json', CacheControl: 'no-store' }));
    const after = await readPerformance(bucket, key);
    if (after.obj.version === candidate.version) return { success: true, performance: candidate };
    // if not, someone else wrote in between; backoff and retry
    await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
    continue;
  } catch (err: any) {
    console.warn('putObject failed, attempt=', attempt, 'err=', err && err.message);
    await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
    continue;
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
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

  try {
    if (event.httpMethod === 'GET') {
      const { obj } = await readPerformance(bucket, key);
      const now = Date.now();
      if (obj.expiresAt && obj.expiresAt > 0 && now > obj.expiresAt) {
        const idle = createIdle(now);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
          body: JSON.stringify(idle),
        };
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders }, body: JSON.stringify(obj) };
    }

    if (event.httpMethod === 'POST') {
      const path = event.path || '';
      let bodyPreview: string | undefined;
      if (!event.body) bodyPreview = undefined;
      else if (typeof event.body === 'string') bodyPreview = event.body.slice(0, 200);
      else {
        try {
          bodyPreview = JSON.stringify(event.body).slice(0, 200);
        } catch (e) {
          bodyPreview = String(event.body).slice(0, 200);
        }
      }
      console.log('Incoming POST', { path, contentType: event.headers && (event.headers['content-type'] || event.headers['Content-Type']), bodyPreview });
      const now = Date.now();

      if (path.endsWith('/claim')) {
        const now = Date.now();
        const current = (await readPerformance(bucket, key)).obj;
        const candidate = { id: 'current', status: 'READY', leaderId: randomId(), participantCount: 0, expiresAt: now + 60 * 60 * 1000, version: (current.version || 0) + 1, createdAt: current.createdAt || now, updatedAt: now, nextVoiceIndex: 0, lastAssignedVoice: null } as Performance;
        try {
          await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(candidate), ContentType: 'application/json', CacheControl: 'no-store' }));
          const after = await readPerformance(bucket, key);
            if (after.obj.status === 'READY' && after.obj.leaderId) {
              return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(after.obj) };
            }
            return { statusCode: 409, headers: corsHeaders, body: JSON.stringify(after.obj) };
        } catch (err: any) {
          console.error('Claim unconditional put failed', err);
          return { statusCode: 500, body: 'Internal server error' };
        }
      }

      if (path.endsWith('/join')) {
  const parts = ['S', 'A', 'B', 'T'];
        const res = await writePerformance(bucket, key, (cur) => {
          if (cur.status === 'READY') {
            const idx = typeof cur.nextVoiceIndex === 'number' ? cur.nextVoiceIndex : 0;
            const voice = parts[idx % parts.length];
            return { ...cur, participantCount: (cur.participantCount || 0) + 1, nextVoiceIndex: (idx + 1) % parts.length, lastAssignedVoice: voice } as Performance;
          }
          return cur;
        });

        if (!res.success) return { statusCode: 409, headers: corsHeaders, body: JSON.stringify(res.performance) };
        const bodyObj = { ...res.performance, voicePart: res.performance.lastAssignedVoice || null };
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(bodyObj) };
      }

      function parseBody(evBody: any) {
        if (!evBody) return {};
        if (typeof evBody === 'string') {
          try {
            return JSON.parse(evBody);
          } catch (e) {
            return {};
          }
        }
        if (typeof evBody === 'object') return evBody;
        return {};
      }

      if (path.endsWith('/start')) {
        const body = parseBody(event.body);
        const res = await writePerformance(bucket, key, (cur, now) => {
          if (cur.status === 'READY' && body.leaderId && body.leaderId === cur.leaderId) {
            return { ...cur, status: 'PLAYING', startTime: now + 2000, expiresAt: now + 60 * 60 * 1000 } as Performance;
          }
          return cur;
        });

  if (!res.success) return { statusCode: 403, headers: corsHeaders, body: JSON.stringify(res.performance) };
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res.performance) };
      }

      if (path.endsWith('/reset')) {
        const body = parseBody(event.body);
        const res = await writePerformance(bucket, key, (cur, now) => {
          const expired = cur.expiresAt && cur.expiresAt > 0 && now > cur.expiresAt;
          if ((body.leaderId && body.leaderId === cur.leaderId) || expired) return createIdle(now);
          return cur;
        });

    if (!res.success) return { statusCode: 409, headers: corsHeaders, body: JSON.stringify(res.performance) };
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(res.performance) };
      }
    }

    return { statusCode: 404, headers: corsHeaders, body: 'Not found' };
  } catch (err) {
    console.error('Handler error', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain', ...corsHeaders }, body: 'Internal server error' };
  }
};
