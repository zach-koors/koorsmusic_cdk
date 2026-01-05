# Choir Feature — CDK Checklist (move to CDK repo)

This file contains the infrastructure tasks that belong in the CDK repository. Move this file into the CDK repo and use it as the authoritative checklist for all infrastructure and Lambda/API work.

Overview
- Minimal, additive changes only: seed a single S3 object (`performance/current.json`), add one Lambda + API Gateway, and grant tight IAM permissions.
- No new bucket or CloudFront distribution creation unless absolutely required.

Phases

Phase 1 — Infrastructure (Delta-only)
- 1.1 Seed `performance/current.json` into the existing site bucket
  - Provide initial object with IDLE state (see data model)
  - Can be a CDK asset or manual upload; the object is never deleted
- 1.2 Add Lambda + API Gateway (additive)
  - Routes: GET /performance, POST /performance/claim, /join, /start, /reset
  - No auth, public access
- 1.3 IAM permissions
  - Lambda scoped to `s3:GetObject` and `s3:PutObject` for `<site-bucket>/performance/current.json` only
- 1.4 CloudFront / caching adjustments
  - Ensure API responses are not cached
  - If `current.json` is served directly from S3, set `Cache-Control: no-store` (recommended: serve via Lambda)

Phase 2 — Lambda Helpers & Read/Write
- 2.1 Implement read/write helpers for `performance/current.json` with safe overwrites and version increments
- 2.2 Integration tests that exercise read/write (local s3 mock or test bucket)

Phase 3 — API Endpoints
- 3.1 GET /performance: read object; if expired synthesize IDLE
- 3.2 POST /performance/claim: race-safe claim -> set READY, leaderId, expiresAt
- 3.3 POST /performance/join: increment participantCount when READY
- 3.4 POST /performance/start: validate leaderId; write PLAYING with startTime (now + 2000ms)
- 3.5 POST /performance/reset: reset to clean IDLE

Phase 8 — Tests & QA (Infra)
- 8.1 Integration tests for endpoints and S3 interaction
- 8.2 Smoke tests post-deploy (endpoints reachable, `current.json` updates propagate)

Deployment & Ops
- CDK: Add Lambda + API Gateway constructs to existing stack; ensure minimal permissions.
- Deploy process: CDK deploys Lambda and any new infra; no change to asset deployment for SPA/audio.
- Monitoring & runbook: logs for failed writes, visibility into leader actions, simple rollback plan

Acceptance
- End-to-end integration tests pass and CDK can seed and mutate `performance/current.json` as expected.
