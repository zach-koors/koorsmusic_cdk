# Decision: Serve environment-specific config.json via CloudFront Function

Date: 2026-01-08

Decision
- Use a CloudFront Function (viewer-request) to rewrite requests for `/assets/config.json` to `/assets/config.prod.json` when the Host header matches production domain names.
- Generate the CloudFront Function inline from `environment.domainNames` so production hostnames are sourced from the stack configuration (single source of truth).
- Deploy both `config.json` and `config.prod.json` to the site S3 bucket under `/assets/` with cache control `no-cache, max-age=0, must-revalidate` and rely on S3 to set Content-Type: `application/json`.

Rationale
- CloudFront Functions are lightweight, low-latency, inexpensive, and sufficient for a small URI rewrite based on headers — no need for Lambda@Edge.
- Generating the function from `environment.domainNames` avoids duplicated/hard-coded hostnames and keeps infra declarative.
- Using `no-cache` ensures clients get the latest config while not being overly strict; `no-store` is available but heavier.

Risks & Mitigations
- Caching stale config: mitigated by `no-cache, max-age=0` on S3 objects and conservative CloudFront behavior TTLs.
- Host header permutations (www/non-www): included in `environment.domainNames` and used by the generated function.
- Function correctness: unit tests assert a CloudFront Function resource exists and Distribution has a viewer-request function association; manual validation steps included in the PR instructions.

Alternatives considered
- Hard-coding hostnames in function source (simpler) — rejected in favor of single source of truth.
- Lambda@Edge (more powerful) — rejected due to complexity and cost for this use case.

Acceptance Criteria
- Requests to `/assets/config.json` return dev or prod configuration depending on host (manual curl tests described in PR).
- Unit tests added and passing locally and in CI.
