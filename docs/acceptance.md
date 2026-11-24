# Release acceptance checklist

Record app/version, source commit, installer checksum, target Zurich build, install actor and sanitized outcomes. Use isolated test incidents and retain their IDs in release evidence outside the distributed package.

## Installation and access

- Import, preview and commit the XML on a clean target using the instance’s required installation privileges. Confirm synchronization is paused and Setup is available in the navigator.
- Verify the page ACL, AJAX actions and native reference lookups reject anonymous/non-admin users. Verify native session/CSRF enforcement for setup requests.
- Configure entirely through Setup. Confirm missing/invalid fields and mappings are reported together. Save failure must leave capture paused. Validate and Enable use saved settings. Enable requires external-check confirmation. Pause must allow editing again after workers finish.
- Inspect the three private tables, twelve CRUD ACLs, their admin-only role mappings, web-service restrictions and four physical unique indexes. Ordinary incident agents must be unable to read/modify private rows.
- Verify dedicated OAuth receiver success. Deny anonymous, Basic, wrong identity, wrong role and forged integration requests. Verify Incident/private Table API denial for the receiver user.
- Confirm Zendesk On-hold is enabled and use a test caller distinct from the worker identity. Preserve the target’s native caller-reply workflow.
- Verify native choice inheritance/dependencies, all five priority outputs, hold reasons, resolution defaults, and audit evidence for inherited Incident fields. Configuration validation alone does not prove these behaviors.

## Bidirectional behavior and failure recovery

- Create an eligible New incident, immediately edit it, and append two identical public comments and two work notes. CREATE must precede updates and each exact journal ID must produce its own event. Check group/title exclusions.
- Verify ticket LINK replay persists the ticket ID once. Exercise title, priority 1–5, In Progress, all hold reasons, resolution and Zendesk-driven closure. Existing closure resolution fields must survive. Confirm inbound changes do not echo. Test independent Zendesk solve followed immediately by closure.
- Fail before-rule capture and verify source writes abort. Abort a source after capture and verify unconfirmed outbox rows never dispatch. Interrupt between source commit and receipt persistence and verify dispatch holds the entry. This release has no receipt reconstruction API.
- Send duplicate deliveries concurrently and verify one durable row and consistent acknowledgments. Reuse identity with different content or reuse a sequence and verify conflict. Reject oversized payloads. Send sequence 2 before 1 and verify ordered application.
- Change a human-owned field between receipt and application and verify FIELD_CONFLICT without overwrite. Other incidents must continue.
- Interrupt after a public comment commits, then restart. Verify exact journal ID recovery prevents duplicate append and different operations with identical text remain distinct. Fail journal evidence writes and expire claims, then verify untracked appends are prevented.
- Interrupt after PATCH commits and verify audit reason, worker username and all requested field effects permit recovery without repeat application. Exercise concurrent human edits.
- Simulate lost gateway responses after ingestion and verify stable event identity/content across eight retries with backoff. Verify claim fencing, lease recovery and concurrent workers. Preserve FAILED/UNCERTAIN rows and check that later operations on that incident wait.

## Upgrade

- Configure a 0.3.3 instance using group routing and another using implicit group-and-title routing. Retain durable rows and sequence numbers, pause, wait for workers and take backups.
- Import and commit the candidate, open Setup, verify loaded settings/effective routing and validate. Verify preserved queue identities and sequence numbers, then enable after the external checks pass.
- Repeat the bidirectional round trip. Confirm no credentials or customer payloads appear in logs or release metadata.

Local test success is recorded separately from native results. Publish the release after native clean-install and upgrade checks pass.
