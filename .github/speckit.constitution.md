# Speckit Constitution for Coding Agents

Purpose
- Provide a compact, enforceable set of rules for automated coding agents to produce secure, maintainable, simple, and highly testable code.

Core Principles
- Security-first: prefer least privilege, validate inputs, fail closed, and document threat models for new surface area.
- Maintainability: code should be readable, well-documented, and follow SOLID and clean-code practices.
 - Simplicity (KISS) & YAGNI: prefer the simplest solution that meets requirements; avoid unnecessary abstractions and don't implement features until they are clearly needed ("You Aren't Gonna Need It").
- Iterative testability: every change must be coupled with automated tests that validate acceptance criteria.
- Clarity of plan: each task must include an explicit, short plan and a one-line acceptance criteria check.

Decision & Execution Protocol
- Plan: create a short, numbered plan with steps, risks, and success criteria before making changes.
- Execute: make changes to implement the plan; include tests and documentation as part of the same PR.
- Double-Check Acceptance Criteria: before finalizing, map acceptance criteria to tests and assert all pass.
- Record: add a Decision Record for non-trivial design choices or trade-offs.

Testing Requirements
- Unit tests: fast, isolated, deterministic; cover success and representative failure cases.
- Integration/smoke tests: for infra and runtime behavior (LocalStack, test buckets, etc.).
- Regression: add tests for every bug fixed.
- CI gating: PRs must pass the test suite and linters before merge.

Security Requirements
- Least privilege for IAM and secrets; secrets must never be committed.
- Validate all inputs server-side and sanitize outputs.
- Document required permissions and include a minimal policy in the PR.
- If encryption or private data is involved, add a short threat model and data flow diagram.

Acceptance Criteria Double-Check (mandatory pre-merge)
1. Acceptance criteria listed in the issue or checklist.
2. For each criterion, list 1–2 tests or checks that prove it.
3. All tests pass locally and in CI. If an acceptance criterion is manual, include clear reproduction steps.

Operational Rules
- Small, focused PRs with meaningful titles and a changelog entry when appropriate.
- Document how to validate changes (commands, env vars, endpoints, sample requests).
- Log and surface telemetry: add structured logs for errors and important state transitions.
 - Commit message style: do not use the "feat:" prefix in commit messages; use concise, imperative messages that clearly describe the change (e.g., "Serve env-specific config via CloudFront Function").

Escalation & Hard Blockers
- If lacking permissions, credentials, or a clear requirement, escalate as a Critical Gap with evidence and suggested actions.
- If CI or deployment is blocked by infra failure, collect logs, attempt a safe retry, and document the failure and mitigation.

Maintenance & Cleanup
- Track technical debt in issues; include remediation plans and owners.
- Remove debug logging and temporary workarounds once they are no longer needed and note them in Decision Records.

Enforcement
- Agents must include the constitution link in PR descriptions when acting autonomously.
- Human reviewers should check adherence to this constitution as part of code review.

Where to put it
- This file is canonical: `.github/speckit.constitution.md`. Refer to it in PR templates and automated agent workflows.

Appendix: Minimal PR checklist
- Title & scope summary
- One-line plan and acceptance criteria
- Tests added and passing
- Security review: IAM/secret check
- Decision Record for non-trivial trade-offs
- Deployment & validation steps

---
Generated to guide automated coding agents to produce secure, simple, maintainable, and testable work. Keep it short; iterate where needed.
