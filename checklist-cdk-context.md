# Choir CDK Context — copy into CDK repo

Purpose
- Provide a concise, copy-pasteable context file for the CDK repository so infra engineers can implement the minimal additions required for the Choir feature.

Keep this file in the Angular repo so it can be pulled into the CDK repo and used as a single source of truth for names, contracts, and deployment notes.

1) S3 object (seed)
- Key: performance/current.json
- Body (initial):

```json
{
  "id": "current",
  "status": "IDLE",
  "version": 0,
  "leaderId": null,
  "createdAt": 0,
  "updatedAt": 0,
  "expiresAt": 0,
  "startTime": null,
  "participantCount": 0
}
```

Notes: this can be uploaded manually once or created as a CDK asset on first deploy. The object is never deleted; Lambda always overwrites it when changing state.

2) S3 Key & Bucket
- Bucket: existing site bucket (the bucket that hosts SPA and audio assets)
- Object key prefix: performance/
- Object path: performance/current.json

3) API Contract (REST)

- GET /performance
  - Response: 200 JSON body (Performance object). If now > expiresAt, return synthesized IDLE (do not mutate S3).

- POST /performance/claim
  - Request: none
  - Behavior: if status === 'IDLE' (or expired), write READY state with new leaderId (random string), participantCount = 0, expiresAt = now + 1h, version++.
  - Response: 200 with updated Performance on success, 409 or 200 with current state if claim failed (implementation choice).

- POST /performance/join
  - Request: none
  - Behavior: if status === 'READY', increment participantCount by 1 and update updatedAt. Best-effort (approximate) counting.
  - Response: 200 with updated Performance (best-effort)

- POST /performance/start
  - Request: { leaderId: string }
  - Behavior: validate leaderId matches stored leaderId; write PLAYING, startTime = now + 2000ms, expiresAt = now + 1h, version++.
  - Response: 200 with updated Performance or 403 if leaderId invalid

- POST /performance/reset
  - Request: { leaderId?: string }
  - Behavior: if leaderId matches OR performance expired, write clean IDLE object (use createIdle defaults), version++.
  - Response: 200 with updated Performance

4) Race-safety & Concurrency
- Use conditional write semantics where available (e.g., S3 object etag/version checks) to avoid lost updates. Simpler approach: read-modify-write and retry on ETag mismatch.
- Each successful state-changing write should increment `version` and update `updatedAt` and `expiresAt`.

5) IAM Policy (example)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::<site-bucket>/performance/current.json"
    }
  ]
}
```

6) CloudFront / Caching
- Ensure API Gateway responses are set to not be cached by CloudFront.
- If you choose to allow S3 direct GET for `current.json`, set `Cache-Control: no-store` or equivalent on the object. Recommended: serve `GET /performance` from Lambda to avoid caching pitfalls.

7) CDK Implementation Notes (TypeScript snippets)
- Lambda function (Node.js or TS) with handler that implements the API contract above
- API Gateway REST resources mapping POST/GET to Lambda (or Lambda Proxy)
- Grant the Lambda the S3 permissions from IAM example above

Example CDK pseudocode:

```ts
const bucket = s3.Bucket.fromBucketName(this, 'SiteBucket', process.env.SITE_BUCKET!);

const lambda = new NodejsFunction(this, 'ChoirFn', {
  entry: join(__dirname, 'lambda', 'handler.ts'),
  runtime: lambda.Runtime.NODEJS_18_X,
  environment: { BUCKET: bucket.bucketName }
});

bucket.grantReadWrite(lambda, 'performance/current.json');

const api = new apigateway.RestApi(this, 'ChoirApi');
const perf = api.root.addResource('performance');
perf.addMethod('GET', new apigateway.LambdaIntegration(lambda));
perf.addResource('claim').addMethod('POST', new apigateway.LambdaIntegration(lambda));
// etc.
```

8) Tests & QA (Infra)
- Unit test Lambda logic locally (e.g., jest) with sample objects
- Integration: run against a test bucket or localstack; exercise read/write and error cases
- End-to-end smoke: deploy to staging, call endpoints, verify `current.json` updates

9) Seeding & Deployment
- Options to seed `performance/current.json`:
  - CDK asset: include initial JSON in the stack as an S3 asset (preferred for automated deploys)
  - Manual: `aws s3 cp performance/current.json s3://<site-bucket>/performance/current.json --content-type application/json --cache-control no-store`

10) Observability & Runbook
- Write CloudWatch logs for unexpected states and write failures
- Provide a simple runbook: how to reset performance (manual S3 upload), how to view logs, how to rollback Lambda

11) Security & Scope
- No public write access to S3 beyond the Lambda (do not allow public write)
- No auth required for API endpoints by design; rely on low-threat model and social constraints

12) Decision Record
- Keep a short DECISION.md in the CDK repo noting: single S3 object, no DB, no websockets; polling-based clients.

If you want, I can also draft the Lambda handler implementation (Node.js), sample unit tests, and a CDK patch you can drop into your stack. Tell me what you'd like me to generate next.
