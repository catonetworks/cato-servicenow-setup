# Installation and release verification

This preview is for an isolated synthetic routing group. Use a setup administrator separate from the runtime OAuth user. Record the ServiceNow release/build with the test evidence; the metadata fields were inspected on Brazil, but metadata inspection alone is not installation acceptance.

1. Create a local update set for the installation and elevate the setup administrator to `security_admin`.
2. Build and review `build/install.js`. Execute it in **global** scope using Scripts - Background with rollback recording enabled. The script upserts package-owned metadata and always sets `cato_sync.enabled=false` first. Unsupported metadata fields fail explicitly. Do not enable a partially installed package.
3. Verify physical unique indexes on `u_key` in all three package tables and `u_stream_key` in the inbox. Dictionary uniqueness is requested by the installer; inspect the resulting database indexes before concurrent use.
4. Create a dedicated web-service-only user with only `cato_sync.receiver` (and the platform's required internal role if applicable). Do not grant `itil`, `admin`, table roles, or broad REST roles. Configure an inbound OAuth application and authorize that user. Keep its refresh token and client secret in the local stack's 1Password entry. The receiver also checks the configured user ID, Bearer authentication, integration ID, and incident ownership.
5. The Scripted REST endpoint is `/api/global/cato_sync/v1/receive`. Platform authentication is required; the resource script enforces the dedicated identity and role. General record-table ACLs remain admin-only. Verify the runtime identity cannot read or write `incident` or the package tables through Table API. Do not weaken existing ACLs to make this test pass.
6. Create a dedicated synthetic assignment group and use incident titles starting `[SYNC-HUB]`. Configure the properties below. Nothing else is eligible for capture or application.
7. Run `servicenow/verify.js` as an administrator and complete the acceptance checks before setting `cato_sync.enabled=true`.

| Property prefix `cato_sync.` | Value |
|---|---|
| `enabled` | `false` until verification is complete |
| `integration_id` | Same UUID as the local hub integration |
| `account_id` | Synthetic account bound by the local gateway |
| `instance_origin` | Exact HTTPS ServiceNow origin, no trailing slash |
| `assignment_group` | Synthetic group sys_id |
| `gateway_url` | Development tunnel HTTPS URL ending `/graphql` |
| `api_key` | Encrypted **Password (2 Way Encrypted)** property containing the local gateway API key |
| `receiver_user` | Dedicated runtime user's sys_id |
| `state_profile` | JSON mapping NEW, IN_PROGRESS, ON_HOLD, RESOLVED and AWAITING_CALLER, AWAITING_VENDOR, AWAITING_CHANGE to this instance's actual state/hold_reason choice values |
| `priority_profile` | JSON map from each priority 1–5 to verified synthetic `impact` and `urgency` inputs |
| `resolution_code` | Valid synthetic resolution choice on this instance |

Inspect `sys_choice` and the incident data policies to populate the profile. Do not assume numeric choice values across releases. Priority derivation rules must be verified with the synthetic profile: configure explicit synthetic impact/urgency inputs in `priority_profile` and verify all five outcomes. The receiver checks persisted field values after application and blocks the stream on an effect mismatch. Production urgency mapping is outside this package.

## Acceptance gate

Use synthetic records only and retain sys_ids plus sanitized outcomes. Never paste tokens or payloads containing real customer data into review evidence.

- Confirm all metadata exists and capture remains disabled after install. Confirm anonymous, Basic-auth, wrong OAuth identity, wrong role, and forged integration requests fail; dedicated OAuth requests succeed.
- Create a new eligible incident in NEW, then immediately update it and add two identical-text public comments and two work notes. Verify CREATE precedes updates and all four exact journal sys_ids produce separate events. Ineligible group/title records produce no events.
- Force outbox insertion failure and verify incident/journal transaction rollback on the actual release. A capture exception must not silently commit an uncaptured source change. If native after-rule transaction semantics do not guarantee this, do not enable capture; adapt the release-specific rule placement and repeat the test.
- Deliver the same inbox ID/content concurrently: one row and consistent acknowledgments. Different content or a reused sequence conflicts. Payloads over 256 KiB fail.
- Deliver sequence 2 before 1: no application until 1 is applied. Change a human-owned field between receipt and application: FIELD_CONFLICT, no overwrite. Verify other incidents continue.
- Apply a public comment, stop the processor between incident update and ledger advance, then restart. Confirm the exact operation marker suppresses the second write and the ledger advances once. Repeat for LINK, retaining the ticket reference.
- Verify session marker propagation into `sys_journal_field.u_cato_sync_effect_key` and that normal human journal rows have no marker. The after-rule must not capture marked receiver echoes. Inspect BR execution order and rollback behavior on the installed release.
- Verify priority 1–5, native hold reasons, and resolution defaults survive all local business rules. Verify no closure or cancellation is synthesized.
- Simulate network loss after hub commit. Outbox retry must reuse byte-equivalent content/event identity. Retry eight times with backoff; preserve FAILED records for diagnosis.
- Check worker claim fencing, lease recovery, unique indexes and local crash recovery with concurrent scheduled executions. No payloads or credentials in logs; only bounded error codes and record IDs.

Until these checks pass, the installer PR stays draft. The package does not claim production readiness or ServiceNow Store certification.

## Upgrade and recovery

Set `enabled=false`; wait for active jobs to finish and export the update set and all package tables through an administrator. Apply the newly generated installer and rerun verification. Installation updates named scripts and metadata in place and never deletes inbox/outbox/state rows or resets sequence numbers. Existing event payloads and delivery IDs remain immutable. Roll back package metadata using the recorded update set/rollback context if required; preserve durable records. Do not delete and recreate an integration while accepted work exists.

FAILED inbox rows block later sequence numbers for that incident. UNCERTAIN effects require operator investigation; this iteration has no repair/replay API. Do not clear markers or manually reset sequences to force progress.

## Security boundaries

Only sandbox data belongs in this preview. The local gateway uses a synthetic identity; production CMA authentication is not provided here. The dedicated receiver role is not a table-access role. Script Includes are server-only. Package tables contain durable payloads and are restricted to administrators. Rotate the gateway key and OAuth secrets through the secret stores, not source files or update sets. Do not enable outbound full-body HTTP logging.

References: [ServiceNow Scripted REST security](https://www.servicenow.com/docs/r/api-reference/rest-api-explorer/c_CustomWebServices.html), [GlideRecord API](https://www.servicenow.com/docs/r/xanadu/api-reference/server-api-reference/c_GlideRecordAPI.html).
