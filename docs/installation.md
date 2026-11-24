# Customer installation from a GitHub Release

Download `cato-sync-hub-0.4.0.xml` and `SHA256SUMS` from the approved [GitHub release](https://github.com/catonetworks/cato-servicenow-setup/releases). Compare the XML file's SHA-256 with the supplied checksum. Release candidates are marked as prereleases and describe outstanding native checks.

The XML contains the Global application, three standalone private tables and their columns, thirteen admin-only ACLs and role mappings, four Script Includes, three Business Rules, the Scripted REST API and operation, two workers, the Setup page and navigator entries, and two default properties. The package contains configuration metadata. Credentials, users, routing groups, customer settings and durable rows stay in their owning environments.

## Import, preview and commit

1. Sign in to the receiving instance with administrator access. Follow the instance's security policy for XML imports containing ACL metadata. The documented Zurich XML-import procedure calls for `security_admin` elevation. The reference instance accepted import, preview and commit with ordinary admin access.
2. Open **System Update Sets → Retrieved Update Sets** and select **Import Update Set from XML**.
3. Choose `cato-sync-hub-0.4.0.xml`, then select **Upload**. Open **Cato Sync Hub 0.4.0** in state Loaded.
4. Select **Preview Update Set**. Review and resolve every preview problem by comparing the proposed update with the target configuration. Re-preview after any resolution. Preserve all required app, table and ACL definitions.
5. Select **Commit Update Set** after preview succeeds. Review the commit log and confirm the final state is Committed. Committing requires `admin`.
6. Open **Cato Sync Hub → Setup**. Confirm synchronization is paused. The app and table definitions are installed by the update set.

[ServiceNow XML transfer and import](https://www.servicenow.com/docs/r/zurich/application-development/system-update-sets/t_SaveAnUpdateSetAsAnXMLFile.html) · [Preview and commit](https://www.servicenow.com/docs/r/zurich/application-development/system-update-sets/t_CommitAnUpdateSet.html)

## Prepare identities and configure

Create an active API Key Credential containing the gateway key, with header `x-api-key`. Keep the key in the native credential store. Runtime access uses `sn_cc.StandardCredentialsProvider` and Setup stores only its sys_id.

Create an active web-service-only receiver user with `cato_sync.receiver` and, where required, `snc_internal`. Limit OAuth access to `/api/global/cato_sync/v1/receive` and configure Sync Hub to authenticate as that user. Verify endpoint success and Incident/private Table API denial through actual requests.

In Setup, enter the matching integration UUID and positive signed 64-bit Cato account ID, gateway HTTPS URL ending `/graphql`, and assignment group. Review the ServiceNow origin and select the credential and receiver user. Select native values for the five states and three hold reasons, impact/urgency inputs for priorities 1–5, and a resolution code. Configure the optional title filter under Routing options.

Select **Save** while paused. Save creates/verifies the four physical unique indexes before persisting configuration. A storage or property write failure leaves synchronization paused. Review the saved values and retry before activation. Select **Validate** to check saved settings, credential access, table protections, indexes and Incident auditing. It sends no network or incident probe.

Complete the [acceptance checklist](acceptance.md), confirm the external checks in the form, and select **Enable**. Enable revalidates saved settings. Verify target priority derivation, dependent choice rules and native audit reason/actor evidence with isolated test records.

## Upgrades and recovery

Pause capture and hub dispatch, wait for active workers, and back up metadata and the three durable tables. Import the reviewed version through the same preview/commit process. Preserve incident sequences, inbox/outbox rows and delivery identities. The disabled property in the package pauses synchronization after import. Verify it before proceeding.

Use matching sender/gateway versions. The gateway must bind the configured account/integration and implement `syncHub.ingestEvent { event { id result state } }`. Its account argument uses the CMA signed-64-bit `Int!` contract and is emitted as an exact JSON integer.

Active 0.2 marker-based integrations require a separate migration. FAILED and UNCERTAIN inbox rows block later operations on that incident and require investigation. The package has no repair/replay API. Keep tokens, payloads and outbound full-body HTTP logging out of release evidence and normal logs.
