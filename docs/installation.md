# Installation and release verification

## Build and publish the Global application

1. On an authorized publisher instance, create the `Cato Sync Hub` Global application in classic ServiceNow Studio. Use the publisher's existing Global application and Application Repository entitlements. Select the app in the application picker and create a dedicated update set for rollback recording.
2. Use System Definition > Tables to create `u_cato_sync_state`, `u_cato_sync_outbox` and `u_cato_sync_inbox` under the application. Leave Extends Table blank. Select **Create access controls**, choose `admin` as the user role and clear **Allow access to this table via web services**. Verify these settings before adding fields or writing runtime data.
3. Run `npm run build` and review `build/install.js`. Run it in Scripts - Background as `admin` with the Cato Sync Hub application selected and rollback recording enabled. The bootstrap verifies the generated CRUD ACLs and app ownership through read-only queries. It adds the table columns, rules, Script Includes, receiver and jobs to the app. Confirm each artifact appears in the application's files before publication. Confirm the private tables' ACLs and role mappings are included and the enabled property is `false`.
4. Check the physical unique indexes for `u_key` on all three tables and `u_stream_key` on the inbox. Use the native table index interface if the physical indexes are missing. Record the source commit, the generated script checksum, and the app sys_id and version, then publish the Global app to the private Application Repository and entitle the target instance.

[Create a table](https://www.servicenow.com/docs/r/zurich/platform-administration/table-administration-and-data-management/t_CreateATable.html) · [Publish through classic Studio](https://www.servicenow.com/docs/r/zurich/application-development/servicenow-studio-classic/working-with-the-app-repo-in-servicenow-studio.html)

## Install and configure the target

1. Install the exact published version using **My Company Applications** as an ordinary `admin`. With an authenticated ServiceNow CI/CD CLI alias and a published, entitled version, run `now-sdk cicd install --auth catorefarch --app-sys-id <app-id> --app-version <version>` and verify the final installation result. Record the app sys_id, version, instance build, actor, and install history. Keep the bootstrap execution on the publisher.
2. Confirm the installed app is disabled. Inspect the generated role mappings, physical indexes and table web-services settings on the target. Check an ordinary incident agent cannot read or modify inbox, outbox or state rows. Verify that scripts and rules are attached to the installed app, with the incident rules and journal rule in Global scope.
3. Create a dedicated web-service-only user with only `cato_sync.receiver` and the platform's required internal role if applicable. Scope its OAuth access to the Scripted REST API at `/api/global/cato_sync/v1/receive`. The script requires the configured user ID, receiver role, Bearer authentication, integration ID and incident ownership. Verify the receiver can authenticate to this endpoint and gets denied on the Incident and package Table APIs.
4. Configure the properties below and run `servicenow/verify.js`. Leave `cato_sync.enabled=false` until the installation and access checks pass. Enable only for the isolated synthetic profile during its acceptance window, then disable it again.

[Install an app from the Application Repository](https://www.servicenow.com/docs/r/zurich/application-development/application-repository-self-hosted/install-app-from-repo.html) · [CI/CD API](https://www.servicenow.com/docs/r/zurich/api-reference/rest-apis/cicd-api.html)

| Property prefix `cato_sync.` | Value |
|---|---|
| `enabled` | `false` until verification is complete |
| `integration_id` | Same UUID as the local hub integration |
| `account_id` | Synthetic account bound by the local gateway |
| `instance_origin` | Exact HTTPS ServiceNow origin, no trailing slash |
| `assignment_group` | Synthetic group sys_id |
| `capture_mode` | `group` for group-based routing. Existing installs without this setting use `group-and-title`. |
| `title_prefix` | Prefix for `group-and-title` mode. The default is `[SYNC-HUB]`. |
| `gateway_url` | Development tunnel HTTPS URL ending `/graphql` |
| `gateway_credential_id` | sys_id of an active API Key Credential holding the local gateway key |
| `receiver_user` | Dedicated runtime user's sys_id |
| `state_profile` | JSON mapping NEW, IN_PROGRESS, ON_HOLD, RESOLVED, CLOSED and AWAITING_CALLER, AWAITING_VENDOR, AWAITING_CHANGE to this instance's actual state/hold_reason choice values |
| `priority_profile` | JSON map from each priority 1–5 to verified synthetic `impact` and `urgency` inputs |
| `resolution_code` | Valid synthetic resolution choice on this instance |

Store the gateway key through the API Key Credentials form, with header `x-api-key`. Keep it private to the synthetic setup; do not distribute it to unrelated MID servers. Only the credential ID belongs in system properties. Runtime access uses [StandardCredentialsProvider](https://www.servicenow.com/docs/r/api-reference/server-api-reference/standard-credentials-provider-api.html); Brazil rejects the deprecated `GlideEncrypter` API. When upgrading from the initial preview, configure the credential, verify access, then clear the legacy `cato_sync.api_key` property. Never put the key into background scripts, update sets, or logs.

Inspect `sys_choice` and the incident data policies to populate the profile. Do not assume numeric choice values across releases. Priority derivation rules must be verified with the synthetic profile: configure explicit synthetic impact/urgency inputs in `priority_profile` and verify all five outcomes. The receiver checks persisted field values after application and blocks the stream on an effect mismatch. Production urgency mapping is outside this package.

## Acceptance gate

Use synthetic records only and retain sys_ids plus sanitized outcomes. Never paste tokens or payloads containing real customer data into review evidence.

- Confirm all metadata exists and capture remains disabled after install. Confirm anonymous, Basic-auth, wrong OAuth identity, wrong role, and forged integration requests fail; dedicated OAuth requests succeed.
- Create a new eligible incident in NEW, then immediately update it and add two identical-text public comments and two work notes. Verify CREATE precedes updates and all four exact journal sys_ids produce separate events. Records from other groups produce no events. In `group-and-title` mode, also verify that a title outside the configured prefix produces no events.
- Force the before-rule outbox insert to fail and verify the source incident or journal write aborts. Abort a source after successful capture and verify the retained outbox stays unconfirmed and dispatch sends nothing. Confirm the matching synchronous after rule finalizes the exact outbox receipt for each rapid edit. Interrupt after the source commits but before the receipt persists and verify that dispatch holds the entry. This release has no automated reconstruction of that receipt from native audits.
- Deliver the same inbox ID/content concurrently: one row and consistent acknowledgments. Different content or a reused sequence conflicts. Payloads over 256 KiB fail.
- Deliver sequence 2 before 1: no application until 1 is applied. Change a human-owned field between receipt and application: FIELD_CONFLICT, no overwrite. Verify other incidents continue.
- Apply a public comment and interrupt the processor after the native journal commits and before the sequence advances. Restart and verify the exact journal `sys_id` recorded in the inbox prevents a second append. Send a different operation with identical text and verify it gets a separate journal ID. Verify normal incident-agent comments are still captured and inbound ones do not echo.
- Force the journal-ID ledger write to fail and verify on the target that the native journal insert aborts. Expire the claim before the callback and verify a stale worker cannot insert an untracked comment. Interrupt after reservation and before native write, and verify later deliveries on that incident wait behind the `UNCERTAIN` operation after retry exhaustion.
- For inbound PATCH recovery, verify the native audit entries carry the exact operation reason and scheduled worker username, including inherited title/priority/state fields and hold reason. Interrupt after native update and before the sequence advances. Verify retry proves the recorded effects without applying them again, even if a later human edit changed the current value. Exercise overlapping human edits during application and verify the conflict behavior.
- Verify LINK replay updates only the private ledger and persists the Zendesk ticket ID once.
- Verify priority 1–5, native hold reasons, and resolution defaults survive all local business rules. Verify Zendesk closure applies the configured Closed choice, preserves existing resolution fields and does not echo. An independent Zendesk solve followed immediately by closure must also close ServiceNow. Customer-originated closure/cancellation and closed-ticket follow-up creation remain unsupported.
- Simulate network loss after hub commit. Outbox retry must reuse byte-equivalent content/event identity. Retry eight times with backoff; preserve FAILED records for diagnosis.
- Check worker claim fencing, lease recovery, unique indexes and local crash recovery with concurrent scheduled executions. No payloads or credentials in logs; only bounded error codes and record IDs.

Until these checks pass, the installer PR stays draft. The package does not claim production readiness or ServiceNow Store certification.

## Upgrade and recovery

Set `enabled=false`, wait for active jobs to finish, then take an app metadata and durable table backup before upgrading. Install the matching published version and rerun verification. Keep the existing inbox/outbox/state records and sequence numbers. Use the recorded app version and rollback context to revert metadata if needed. Preserve accepted work and delivery identities.

FAILED and UNCERTAIN inbox rows block later sequence numbers on that incident. A reservation survives worker restarts. Retry can confirm an exact effect from the ledger or audit. A reserved operation with missing evidence eventually reaches UNCERTAIN and requires investigation. There is no repair or replay API in this release.

The 0.3 bootstrap is for a clean installation. It stops when it sees the 0.2 marker schema. Moving active 0.2 integrations requires a separate migration because their durable records and proof rules differ. Preserve the old ledger and source evidence during migration planning.

## Security boundaries

Use synthetic data with the local gateway and keep managed-environment verification as the production release gate. The dedicated receiver role is not a table-access role. Script Includes are server-only. Package tables contain durable payloads and are restricted to administrators. Rotate the gateway key and OAuth secrets through the secret stores, not source files or update sets. Do not enable outbound full-body HTTP logging.

References: [ServiceNow Scripted REST security](https://www.servicenow.com/docs/r/api-reference/rest-api-explorer/c_CustomWebServices.html), [GlideRecord API](https://www.servicenow.com/docs/r/xanadu/api-reference/server-api-reference/c_GlideRecordAPI.html).

The reviewed local GraphQL contract wraps ingestion as `ingestEvent { event { id result state } }`. Upgrade the matching local gateway and this installer together while capture is paused; REST source envelopes and durable source identities are unchanged.

The sender converts its captured REST table `incident` to GraphQL `INCIDENT` after commit verification. Stored outbox payloads retain their original identities/content.

### Upgrade to 0.3.2

Pause capture and hub dispatch, upgrade the receiver first, and add the verified native Closed
choice to `state_profile.CLOSED` before running the hub with Zendesk closure support. The value
must differ from NEW, IN_PROGRESS, ON_HOLD and RESOLVED. Missing or ambiguous configuration
fails with STATE_PROFILE_REQUIRED. Preserve existing close code/notes; configured resolution
defaults fill them only when absent. Retain earlier failed deliveries for controlled recovery;
this upgrade does not reset or replay accepted work.
