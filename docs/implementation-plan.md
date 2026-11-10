# Production Hardening Implementation Plan

> For agentic workers: use the approved review and docs/architecture.md; implement independent domains with tests, then independent code review. The user has explicitly authorized implementation, cleanup, GitHub push and server rollout.

**Goal:** Ship the approved review fixes and useful operational workflows, preserving runtime data and verifiably synchronizing local/GitHub/server sources.

**Architecture:** Modular monolith, existing Vue/Express stack; independent access, session, audit, operations and release modules.

**Spec:** docs/architecture.md and the review accepted in this chat.

## Constraints and interfaces

- Current baseline 99a1272995618206dd75b77a17c4345bb8e47ab7; existing cleanup and process-health changes are preserved.
- Root owns auth/config/user/role/access/audit/index and integration. Frontend worker owns frontend only. Operations worker owns actions/kube/clusterService/routes/operations and its tests. Release worker owns deploy/Docker/Compose/CI/docs and integration TLS defaults, no server changes beyond registry/monitor helpers if coordinated.
- Role scope: `{clusters:string[],namespaces:string[],resources:string[]}`; '*' is wildcard; core resource `_core/pods`. Extra permissions are listed in architecture doc.
- Root provides `assertResourceAccess(account,{clusterId,namespace,group,plural,verb})`, `assertClusterAccess(account,clusterId)` and `filterNamespaces(account,items)` from access.js. Denials throw status 403. Require explicit namespace for non-global namespace-scoped authorization.
- Apply options `{dryRun:boolean, force:boolean}`; force requires explicit elevated permission; response `{results:[{ok,name,message,operation?}],dryRun}`.
- Operations API will be sent to frontend before dependent UI work; no destructive live test.

## Review focus

1. Namespace-restricted users must not escape via apply, overview, metrics, CRD or terminal.
2. Missing resource versus failed request and partial apply must remain distinct.
3. Revoked credentials must terminate HTTP and long-lived sessions.
4. Rollback/drain/restart must preserve Kubernetes preconditions and disruption budgets.
5. Release rollback must preserve runtime volumes and cannot overwrite another revision.

## Tasks

### 1. Security and authorization (root)
- [ ] Add failing access/session/kubeconfig/audit tests with disposable test data.
- [ ] Implement scoped grants, explicit sensitive permissions, safe configuration loading, sessions, login limit, revocation and redacted audit.
- [ ] Integrate HTTP/SSE/WS authorization, sensitive response boundaries, short-lived stream tickets and TLS/browser headers.
- [ ] Verify regression tests and syntax checks; coordinate UI role scope fields.

### 2. Kubernetes correctness and operations (worker)
- [ ] Write failing tests for Apply modes/results, trust checks, exact discovery version, status/diagnostic data and controller safety.
- [ ] Fix import trust, Apply dry-run/non-force, precise discovery, partial errors, expose fault summaries.
- [ ] Add release history/rollback, CronJob immediate-run/suspend, EndpointSlice navigation data, node maintenance with preflight/Eviction and PDB blocking.
- [ ] Apply access checks to every read/write path, filter aggregate responses and test denials.

### 3. Frontend workflows (worker)
- [ ] Regression tests for semantic status, selectors, scoped metadata, filters, results and stale requests.
- [ ] Correct Service relationships, errors, paging/filters, selection lifetime, secret masking and YAML editing/diff/preflight.
- [ ] Redesign overview priorities/metrics clarity and accessible navigation; wire useful release/node/task actions and audit page.
- [ ] Add role scope/sensitive permission inputs; production build.

### 4. Release architecture and deployment (worker + root rollout)
- [ ] Tests/checks for immutable revision, manifests, persistence and rollback scripts.
- [ ] Separate probes, persist K8s template data, secure integration TLS defaults/CA, remove plaintext password logs.
- [ ] Add backup + release + verify scripts, CI tests/build and documentation.
- [ ] Inspect unused tracked files by reference; remove only identified artifacts. Preserve local user-data directories and runtime secrets.

### 5. Integration, review and delivery (root)
- [ ] Full tests/build + independent reviewer; fix all important issues.
- [ ] Server private backup and canary image, read-only smoke validation, production switch with rollback.
- [ ] Commit/push authorized main after successful verification, upload exact final source and verify 3-way revision/manifest equality.
- [ ] Deliver commit, access URL, check evidence and remaining external configuration needs.
