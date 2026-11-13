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

## Approved priority fixture and real OAuth pipeline

The isolated fixture in `sandbox/install-priority-fixture.js` was approved and installed (history `168a6e5dc3ac5b50e776b523e40131fa`). Native checks in history `a9aa229dc3ac5b50e776b523e40131c3` passed: incident `65aa269dc3ac5b50e776b523e4013144` created and retained priority 5, then changed to 4 using impact 2 / urgency 3. Unprefixed control `52aa669dc3ac5b50e776b523e401314a` and out-of-group control `96aa669dc3ac5b50e776b523e4013175` remained at native priority 4. The shared matrix was not changed.

Brazil rejected the deprecated `GlideEncrypter` API. The implementation now uses `sn_cc.StandardCredentialsProvider` with an active API Key Credential; encrypted-at-rest retrieval and authenticated GraphQL returned HTTP 200. The legacy property was cleared, and only `gateway_credential_id` is stored in properties. Compatibility installation history: `9e6ce251c3ec5b50e776b523e4013145`.

Fresh incident `898ca691c3ec5b50e776b523e401316a` created Zendesk ticket `849649` through the containerized service. Receiver LINK applied. Two same-text public comments and a private work note each reached Zendesk separately. An explicit Zendesk **Test webhook** notification suppressed the original operation echoes. Subsequent synthetic Zendesk updates, normalized after another signed test notification, applied title, priority 2 and In Progress. Reverse journals `799eea95c3ec5b50e776b523e40131b3` and `f59eea95c3ec5b50e776b523e40131ee` were distinct despite identical text and retained exact operation markers; the Zendesk private note was absent. A genuine Zendesk low/pending update applied as native priority 4/On Hold/Awaiting Caller.

The initial tests used explicit provider-signed notifications. A subsequent fresh automatic round trip required no Test webhook: incident `43c2b69dc3ec5b50e776b523e401313d` created Zendesk ticket `849652`; ordinary notifications applied its updated title, public journal `39e2be9dc3ec5b50e776b523e401312e` (operation `d89ea526-6dd0-43d1-9cdc-55125b1dc3ab`), and resolution. Native inspection confirmed state 6, priority 5, and the configured close code/notes. Ordinary notification IDs: `01M7ATP99E5B51TMCZ8KB6PW83` and `01M7ATQM9M5491MFHPFM3K0SNN`. Creation echo `01M7ATNW9MBX88GFDXFMK82J39` was ignored.

Incident `f0217ad9c3ec5b50e776b523e401312b` also created and resolved ticket `849650` through ordered outbound delivery. The synthetic Zendesk mapping revision supplies its required Type and Urgency only at creation. The sandbox notification trigger uses the persistent synthetic tag because a shared solve rule changes ticket groups; the shared close rule excludes that tag to preserve supported resolution.

Capture and receiver application are paused with `cato_sync.enabled=false`; the local integration and dedicated webhook are paused and the temporary tunnel is stopped. Durable state is retained. Pause history: `48637211c3209b50e776b523e40131e0`.

## Outstanding checks

Automatic delivery passed on the fresh fixture above. Provider-side rate-limit/lost-response injection remains unclaimed. Thirteen local Node tests pass; these are separate from the native evidence above.

Licensing remains unresolved. Keep the installer PR draft regardless of test results.
