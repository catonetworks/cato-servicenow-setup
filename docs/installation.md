# Customer installation from a GitHub Release

Download `cato-sync-hub-0.4.0.xml` and `SHA256SUMS` from the approved [GitHub release](https://github.com/catonetworks/cato-servicenow-setup/releases). Compare the XML file's SHA-256 with the supplied checksum. Release candidates are marked as prereleases and describe outstanding native checks.

The XML contains the Global application, three standalone private tables and their columns, thirteen admin-only ACLs and role mappings, four Script Includes, three Business Rules, the Scripted REST API and operation, two workers, the Setup page and navigator entries, and two default properties. The package contains configuration metadata. Credentials, users, routing groups, customer settings and durable rows stay in their owning environments.

## Start with Cato-assisted onboarding

**The integration UUID is provided by Cato after Cato registers your integration.** Request Sync Hub onboarding from the Cato contact arranging your rollout. Receive the completed connection handoff described below before enabling synchronization. Generating a UUID yourself, importing this XML, or creating a ServiceNow credential does not register an integration in Cato.

Version 0.4.0 supplies the ServiceNow component. It does not provide a customer-facing provisioning screen or setup API. Cato must separately prepare a compatible gateway/service, account authorization, backend integration, secrets and Zendesk routing/callbacks. The [Cato-side provisioning checklist](cato-provisioning.md) identifies the required work and the current managed-provisioning gap. If Cato cannot confirm that preparation is complete, keep synchronization paused.

The sequence is: **request onboarding → import XML while paused → prepare ServiceNow receiver/OAuth → Cato completes backend registration and returns connection values → configure Setup → joint validation → coordinated Enable**. XML import and local preparation can proceed while Cato prepares its service.

## Where every Setup value comes from

| Setup field | Who supplies it / where the customer gets it | Customer action |
| --- | --- | --- |
| Integration UUID | **Cato connection handoff**, after registration of this account and ServiceNow instance in the backend | Copy the exact registered integration ID. Do not generate one or substitute a ServiceNow sys_id, OAuth client ID or Zendesk ZIS integration name. |
| Cato account ID | **Cato connection handoff**; Cato verifies the actual customer account and gateway authorization | Copy the numeric account ID exactly. It must match the account bound to the integration and credential. |
| Gateway GraphQL URL | **Cato connection handoff** for the approved deployed gateway | Copy the full HTTPS endpoint ending `/graphql`. Use the supplied endpoint, not an assumed public GraphQL URL or a temporary test endpoint. |
| ServiceNow HTTPS origin | Prefilled by the installed Setup page from **this ServiceNow instance** | Review the canonical origin with the ServiceNow administrator. Tell Cato the same origin for backend registration. |
| Assignment group | **Customer ServiceNow administrator**, using the target instance’s Groups records | Create or select the active group that should route incidents to Cato. Agree its use with the incident process owner. |
| API key credential | **Customer ServiceNow administrator** creates a native API Key Credential using the gateway API key **securely supplied by Cato** | Store the key in the native credential record with header `x-api-key`, then select that record. The form stores only its reference. A general CMA key must not be assumed to work without Cato confirming this gateway’s authorization. |
| OAuth receiver user | **Customer ServiceNow administrator**, using the target instance’s Users records after XML import installs `cato_sync.receiver` | Create the dedicated active web-service-only user and select it. Prepare the OAuth application separately as described below. |
| Routing mode | **Customer incident process owner** and ServiceNow administrator | Choose assignment-group routing, or group plus a title prefix. Existing effective routing is retained on upgrade. |
| Optional title filter | **Customer incident process owner** | Choose the prefix for group-and-title routing. The displayed `[SYNC-HUB]` default is a filter value to review, not an integration ID. |
| New / In Progress / On Hold / Resolved / Closed mappings | **Customer ServiceNow administrator**, from the Setup page’s native Incident/Task state choices | Select the five corresponding values. Closed must be a distinct native state. |
| Awaiting Caller / Vendor / Change mappings | **Customer ServiceNow administrator**, from native Incident hold-reason choices | Select the three supported reasons. Cato must also enable Zendesk’s optional On-hold status for Vendor/Change delivery. |
| Priority rows 1–5: impact and urgency | **Customer ServiceNow administrator**, from native choices and the target’s priority calculation rules | Select inputs for each row and test that the native result is exactly 1, 2, 3, 4 or 5 as intended. Do not copy another instance’s inputs without checking them. |
| Resolution code | **Customer ServiceNow administrator**, from the target’s native resolution-code choices | Select a valid code approved by the incident process owner. |
| External-check confirmation | **Joint Cato/customer validation results**, not a supplied configuration value | Check only after the connection, receiver/API restrictions, five priority derivations and Zendesk On-hold prerequisites pass. |

The current form labels the first field **Integration UUID**. Read it as **Integration ID — provided by Cato**. None of these fields is filled from GitHub automatically.

## The two directions use separate credentials

- **ServiceNow → Cato:** Cato supplies the approved gateway API key through an agreed secure channel. The customer stores it in a native API Key Credential and selects that record in Setup.
- **Cato → ServiceNow:** the customer ServiceNow administrator creates the receiver user and OAuth application. Share the token endpoint, approved grant, client ID and the required client secret/refresh material with Cato through the agreed secure onboarding channel. Bind authorization to the dedicated receiver user and intended scope. Cato stores this material in its approved secret store; it does not receive ServiceNow administrator credentials.
- **Cato → Zendesk / Zendesk → Cato:** Cato configures its own Zendesk runtime OAuth, routing, notification integration and verification material. The customer does not enter those values in ServiceNow Setup.

The customer supplies Cato the ServiceNow HTTPS origin and receiver endpoint `<ServiceNow HTTPS origin>/api/global/cato_sync/v1/receive`, plus the receiver OAuth details above. Do not put API keys, client secrets, refresh tokens or access tokens in this guide, the presentation, GitHub issues or ordinary email.

## Import, preview and commit

1. Sign in to the receiving instance with administrator access. Follow the instance's security policy for XML imports containing ACL metadata. The documented Zurich XML-import procedure calls for `security_admin` elevation. The reference instance accepted import, preview and commit with ordinary admin access.
2. Open **System Update Sets → Retrieved Update Sets** and select **Import Update Set from XML**.
3. Choose `cato-sync-hub-0.4.0.xml`, then select **Upload**. Open **Cato Sync Hub 0.4.0** in state Loaded.
4. Select **Preview Update Set**. Review and resolve every preview problem by comparing the proposed update with the target configuration. Re-preview after any resolution. Preserve all required app, table and ACL definitions.
5. Select **Commit Update Set** after preview succeeds. Review the commit log and confirm the final state is Committed. Committing requires `admin`.
6. Open **Cato Sync Hub → Setup**. Confirm synchronization is paused. The app and table definitions are installed by the update set.

[ServiceNow XML transfer and import](https://www.servicenow.com/docs/r/zurich/application-development/system-update-sets/t_SaveAnUpdateSetAsAnXMLFile.html) · [Preview and commit](https://www.servicenow.com/docs/r/zurich/application-development/system-update-sets/t_CommitAnUpdateSet.html)

## Prepare identities and configure

Using the gateway key securely supplied in the Cato handoff, create an active API Key Credential containing that key, with header `x-api-key`. Keep the key in the native credential store. Runtime access uses `sn_cc.StandardCredentialsProvider` and Setup stores only its sys_id.

Create an active web-service-only receiver user with `cato_sync.receiver` and, where required, `snc_internal`. Limit OAuth access to `/api/global/cato_sync/v1/receive` and configure Sync Hub to authenticate as that user. Verify endpoint success and Incident/private Table API denial through actual requests.

Zurich can automatically inherit `snc_required_script_writer_permission` through its Conditional Script Writer group. Setup permits that inherited platform gate; it does not grant table or field access by itself. Do not assign it directly or add application/data-access roles to the receiver. See [ServiceNow's two-layer scripting access model](https://www.servicenow.com/docs/r/zurich/platform-security/access-control/explore-sgt.html).

In Setup, copy the registered integration UUID, positive signed 64-bit Cato account ID and gateway HTTPS URL ending `/graphql` from the Cato handoff. Select the customer-owned assignment group. Review the ServiceNow origin and select the credential and receiver user. Select native values for the five states and three hold reasons, impact/urgency inputs for priorities 1–5, and a resolution code. Configure the optional title filter under Routing options.

Select **Save** while paused. Save creates/verifies the four physical unique indexes before persisting configuration. A storage or property write failure leaves synchronization paused. Review the saved values and retry before activation. Select **Validate** to check saved settings, credential access, table protections, indexes and Incident auditing. It sends no network or incident probe.

While paused, verify gateway connectivity, OAuth receiver access, Incident/private Table API denial, and all five native priority mappings with isolated test records. Have the Zendesk administrator confirm the optional On-hold status is enabled; Vendor and Change holds require it. See [Zendesk On-hold setup](https://support.zendesk.com/hc/en-us/articles/4408889282458-Adding-the-On-hold-ticket-status-to-Zendesk-Support). Use a separate incident caller and worker identity during acceptance, since native caller replies can reopen an Awaiting Caller incident. Have Cato confirm the matching backend integration and dispatch are ready, coordinate activation on both sides, then confirm those external checks in the form and select **Enable**. Enable revalidates saved settings. Then run the bidirectional tests in the [acceptance checklist](acceptance.md) using eligible New incidents with nonblank titles (at most 160 characters) and descriptions, including dependent choice rules and native audit reason/actor evidence, before production rollout. Pause again if any check fails.

## Upgrades and recovery

Pause capture and hub dispatch, wait for active workers, and back up metadata and the three durable tables. Import the reviewed version through the same preview/commit process. Preserve incident sequences, inbox/outbox rows and delivery identities. The disabled property in the package pauses synchronization after import. Verify it before proceeding.

Use matching sender/gateway versions. The gateway must bind the configured account/integration and implement `syncHub.ingestEvent { event { id result state } }`. Its account argument uses the CMA signed-64-bit `Int!` contract and is emitted as an exact JSON integer.

Active 0.2 marker-based integrations require a separate migration. FAILED and UNCERTAIN inbox rows block later operations on that incident and require investigation. The package has no repair/replay API. Keep tokens, payloads and outbound full-body HTTP logging out of release evidence and normal logs.
