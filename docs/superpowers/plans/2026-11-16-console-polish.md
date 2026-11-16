# Console polish implementation plan

> **For agentic workers:** Apply focused implementation and verification; tasks have disjoint file ownership.

**Goal:** Complete the seven browser comments and expose Grafana discovery from the selected cluster.

**Architecture:** Keep the existing Vue/Element Plus UI and Express API. Add a discovery service following existing resource access rules; use summaries and on-demand detail for dense UI.

**Tech Stack:** Vue 3, Element Plus, CSS, inline SVG, Node.js/Express, node:test.

**Spec:** `docs/superpowers/specs/2026-11-16-console-polish-design.md`

## Global constraints

- Light visual style and blue brand; no new dependencies.
- No permission expansion, secret reads, or automatic saving discovered endpoints.
- Preserve the existing untracked `editor-ui-redesign.md`.

## Review focus

- Resource/cluster scope and namespace filters must apply to discovered candidates.
- Browser URLs must distinguish external endpoints from cluster-only services.
- Discovery errors and cancelled/stale responses must not appear as a valid empty list.
- Permission summaries must preserve every action and precise scope in detail.
- Compact/mobile login layout and existing failed-connection recovery must remain usable.

### Task 1: Login and redundant UI

- [x] Replace Login.vue artwork and related styles with light clustered server nodes.
- [x] Remove login deployment note, overview timestamp, global header refresh.
- [x] Keep registry success tag and show failure reason only when needed.
- [x] Update existing browser smoke expectations to match removed refresh control.
- [x] Build frontend; clamp illustration to available height for short desktop screens.
- [ ] Desktop/mobile screenshot acceptance: browser tool stopped because it could not determine the Windows browser URL reliably; no visual acceptance claim.

### Task 2: Role presentation

- [x] Add focused grouping/scope behavior tests and observe expected failure.
- [x] Implement compact summary helpers and Roles.vue popovers.
- [x] Run focused tests (3/3); review full permission detail and unchanged form actions in source.

### Task 3: Grafana discovery

- [x] Add service/URL/access and frontend async behavior tests; confirm expected failure.
- [x] Add discovery endpoint, service and API wrapper.
- [x] Add scan dialog with candidate source, address and add-to-form action.
- [x] Complete focused regression checks for in-cluster IP and late cluster-list errors. Backend discovery 9/9; frontend discovery/context 11/11. Renderer/agent services are excluded before port heuristics.

### Task 4: Integration and release

- [x] Review combined changes; frontend build/backend syntax checks passed. Focused cases passed: roles 3/3, backend discovery 9/9, frontend discovery 7/7 and existing context 5/5. Default discovery scans all authorized namespaces; release pipeline remains without automatic suites/browser regression.
- [ ] Use existing manifest/release workflow and retained runtime mounts for deployment.
- [ ] Verify deployed source version and browser behavior, report concrete evidence.
