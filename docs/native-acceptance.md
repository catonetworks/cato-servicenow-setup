# Native sandbox acceptance — 2026-11-13

Target: ServiceNow Brazil, build `glide-brazil-08-25-2026__patch1-hotfix1-10-10-2026`. These observations apply to the isolated synthetic profile, not to other releases or customer environments.

## Observed

- Installation completed with capture disabled.
- Dictionary `unique=true` alone did not enforce unique inserts. Native `gs.ensureIndex` plus index-descriptor verification created the required indexes; duplicate inserts were then rejected in the state, outbox and inbox tables. The installer includes this step.
- Java strings require explicit `String(...)` conversion before JavaScript length checks in the native script engine. The capture size check includes that fix.
- Incident `dfe92d51c3e45b50e776b523e40131e8` produced a CREATE event, two separate public journal events with identical text, and one private work-note event. Public journal IDs: `7fe96d51c3e45b50e776b523e40131a7`, `f7e96d51c3e45b50e776b523e40131c1`; private ID: `b7e96d51c3e45b50e776b523e40131ca`.
- Native state codes are New 1, In Progress 2, On Hold 3, Resolved 6. Hold reasons are Caller 1, Vendor 4, Change 5. The synthetic resolution code is `Resolved – Permanent Fix Applied`.
- Dedicated receiver user `sync_hub_receiver` has the receiver role. Its client-credentials OAuth application is restricted to `cato_sync.receiver` and API `global/cato_sync`, with access outside that scope disabled.

## Blocking failure and outstanding checks

An after-rule capture exception did **not** abort source incident `cb19e5ddc3a45b50e776b523e401317e`. Capture remains disabled. Before-rule source abort with exact committed-operation/journal evidence is a proposed correction, not implemented or verified behavior.

Receiver token issuance, negative Table API access, native inbox application, receiver restart/effect recovery, source-failure handling, and the full live round trip are still pending. Five local Node tests pass, but they do not substitute for these native checks.

Licensing remains unresolved. Keep the installer PR draft regardless of test results.
