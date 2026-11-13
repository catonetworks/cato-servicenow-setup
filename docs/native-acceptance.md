# Native sandbox acceptance — 2026-11-13

Target: ServiceNow Brazil, build `glide-brazil-08-25-2026__patch1-hotfix1-10-10-2026`. These observations apply to the isolated synthetic profile, not to other releases or customer environments.

## Observed

- Installation completed with capture disabled.
- Dictionary `unique=true` alone did not enforce unique inserts. Native `gs.ensureIndex` plus index-descriptor verification created the required indexes; duplicate inserts were then rejected in the state, outbox and inbox tables. The installer includes this step.
- Java strings require explicit `String(...)` conversion before JavaScript length checks in the native script engine. The capture size check includes that fix.
- Incident `dfe92d51c3e45b50e776b523e40131e8` produced a CREATE event, two separate public journal events with identical text, and one private work-note event. Public journal IDs: `7fe96d51c3e45b50e776b523e40131a7`, `f7e96d51c3e45b50e776b523e40131c1`; private ID: `b7e96d51c3e45b50e776b523e40131ca`.
- Native state codes are New 1, In Progress 2, On Hold 3, Resolved 6. Hold reasons are Caller 1, Vendor 4, Change 5. The synthetic resolution code is `Resolved – Permanent Fix Applied`.
- Dedicated receiver user `sync_hub_receiver` has the receiver role. Its client-credentials OAuth application is restricted to `cato_sync.receiver` and API `global/cato_sync`, with access outside that scope disabled.

## Commit-evidence capture and receiver — package 0.2.0

An after-rule capture exception did **not** abort source incident `cb19e5ddc3a45b50e776b523e401317e`. Version 0.2.0 replaces it with before-rule source abort and committed-operation/journal evidence. Native failure injection verified:

- Outbox insertion failure prevented incident `0be12a91c36c5b50e776b523e4013134` from committing.
- A later source abort left an outbox for absent incident `4be12a91c36c5b50e776b523e4013134`; `sourceCommitted` rejected it. Rapid updates on `8be12a91c36c5b50e776b523e4013134` retained matching current/audit evidence for both revisions.
- Outbox failure also aborted the exact journal insertion. The incident update itself is a separate source operation; the test does not claim rollback of unrelated field changes.
- Incident `4a42225dc36c5b50e776b523e4013145` captured its initial comment, two identical-text public comments, and one private work note. All four exact journal IDs had committed evidence. Public IDs: `4242225dc36c5b50e776b523e401315c`, `2a42625dc36c5b50e776b523e401314d`, `e242625dc36c5b50e776b523e4013159`; private ID: `e642625dc36c5b50e776b523e401316e`.
- Runtime OAuth returned HTTP 200 with scope `cato_sync.receiver`; the incident Table API returned HTTP 403. Receiver requests returned HTTP 202 for acceptance and duplicate content.
- Journal delivery `30645fb8-233f-4838-bc6c-bfb0fcdb2ed8` waited behind LINK sequence 1, then produced journal `8753a6ddc36c5b50e776b523e40131e1` with operation marker `48240d2c-b25b-4500-b4ab-581dd12ac2f5`. A subsequent stale priority expectation failed with `FIELD_CONFLICT` and did not advance the stream.
- Simulated interruption after native application but before inbox completion was recovered by expiring the claim and constructing a new receiver instance. Deliveries `89242251-c3ac-5b50-e776-b523e401314f` and `4d242251-c3ac-5b50-e776-b523e4013151` each retained exactly one journal despite identical text. This is native claim-recovery fault injection, not a ServiceNow node reboot.
- Native inbox application passed priorities 1–4, In Progress, awaiting caller/vendor/change, and Resolved with the configured resolution defaults. Execution history: `f3946e51c3ac5b50e776b523e401312b`.

Native testing exposed that `GlideRecord.setValue` ignores journal fields. The receiver now uses the [supported journal API](https://www.servicenow.com/docs/r/api-reference/server-api-reference/c_GlideRecordAPI.html) and verifies exact operation/incident/visibility/content evidence before advancing. Missing evidence after an incident marker is retained as a failure rather than repeated blindly.

Installation history: `dba1ae99c36c5b50e776b523e40131b9`; receiver journal correction: `01c2629dc36c5b50e776b523e4013159`. Capture is paused between test windows; temporary failure rules remain inactive for inspection.

## Outstanding checks

The full ServiceNow–Zendesk round trip remains pending. The sandbox's priority matrix maps impact 3 / urgency 3 to priority 4 and overrides direct priority-5 writes; an isolated synthetic override needs approval before the priority-5 live scenario. Ten local Node tests pass; these are separate from the native evidence above.

Licensing remains unresolved. Keep the installer PR draft regardless of test results.
