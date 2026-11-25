# Customer installation from a GitHub Release

Download `cato-sync-hub-0.4.0.xml` and `SHA256SUMS` from the approved [GitHub release](https://github.com/catonetworks/cato-servicenow-setup/releases). Compare the XML file's SHA-256 with the supplied checksum. Release candidates are marked as prereleases and describe outstanding native checks.

The XML contains the Global application, three standalone private tables and their columns, thirteen admin-only ACLs and role mappings, four Script Includes, three Business Rules, the Scripted REST API and operation, two workers, the Setup page and navigator entries, and two default properties. The package contains configuration metadata. Credentials, users, routing groups, customer settings and durable rows stay in their owning environments.

## Installation permissions and target release

The customer installer must have `admin` and the ability to elevate to `security_admin`. Before importing the XML, open the user menu, select **Elevate Roles**, select **security_admin**, and confirm. Keep the elevated session for import, preview, commit and any required ACL inspection or repair. The update set already includes all thirteen ACLs and their role mappings; there is no separate manual ACL-creation step.

After installation and ACL checks, end the elevation. **Cato Sync Hub → Setup** and its **Save, Validate, Enable and Pause** actions require ordinary `admin`, including creation/verification of indexes during Save. The dedicated OAuth receiver uses `cato_sync.receiver` and permitted platform prerequisites only. Never give that integration identity `admin` or `security_admin`.

The customer plans to use **ServiceNow Australia**. The 0.4.0 native installation, upgrade and synchronization evidence is from **Zurich**. Complete the acceptance checklist on the exact Australia build/patch before production activation, including XML/ACL import, Setup credential access and index creation, OAuth restrictions and the bidirectional round trip. This guide does not claim that Australia has passed those checks.

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

1. Sign in as the customer installation administrator with `admin`, then use **Elevate Roles → security_admin**. Use this elevated session to import the package and verify its security metadata. Follow the receiving instance’s change-control policy.
2. Open **System Update Sets → Retrieved Update Sets** and select **Import Update Set from XML**.
3. Choose `cato-sync-hub-0.4.0.xml`, then select **Upload**. Open **Cato Sync Hub 0.4.0** in state Loaded.
4. Select **Preview Update Set**. Review and resolve every preview problem by comparing the proposed update with the target configuration. Re-preview after any resolution. Preserve all required app, table and ACL definitions.
5. Select **Commit Update Set** after preview succeeds. Review the commit log and confirm the final state is Committed. Committing requires `admin`.
6. Verify the packaged ACLs and role mappings, then end `security_admin` elevation. Open **Cato Sync Hub → Setup** as ordinary `admin`. Confirm synchronization is paused. The app and table definitions are installed by the update set.

[ServiceNow XML transfer and import](https://www.servicenow.com/docs/r/application-development/system-update-sets/t_SaveAnUpdateSetAsAnXMLFile.html) · [ACL administration](https://www.servicenow.com/docs/r/platform-security/access-control/t_CreateAnACLRule.html) · [Preview and commit](https://www.servicenow.com/docs/r/zurich/application-development/system-update-sets/t_CommitAnUpdateSet.html)

## Prepare identities and configure

Using the gateway key securely supplied in the Cato handoff, create an active API Key Credential containing that key, with header `x-api-key`. Keep the key in the native credential store. Runtime access uses `sn_cc.StandardCredentialsProvider` and Setup stores only its sys_id.

Create an active web-service-only receiver user with `cato_sync.receiver` and, where required, `snc_internal`. Limit OAuth access to `/api/global/cato_sync/v1/receive` and configure Sync Hub to authenticate as that user. Verify endpoint success and Incident/private Table API denial through actual requests.

Zurich can automatically inherit `snc_required_script_writer_permission` through its Conditional Script Writer group. Setup permits that inherited platform gate; it does not grant table or field access by itself. Do not assign it directly or add application/data-access roles to the receiver. See [ServiceNow's two-layer scripting access model](https://www.servicenow.com/docs/r/zurich/platform-security/access-control/explore-sgt.html).

In Setup, copy the registered integration UUID, positive signed 64-bit Cato account ID and gateway HTTPS URL ending `/graphql` from the Cato handoff. Select the customer-owned assignment group. Review the ServiceNow origin and select the credential and receiver user. Select native values for the five states and three hold reasons, impact/urgency inputs for priorities 1–5, and a resolution code, using the explanation below. Configure the optional title filter under Routing options.

## What Incident mappings mean

**Mappings tell Sync Hub which existing ServiceNow choices mean New, In Progress, On Hold, Resolved and Closed.** They let the integration translate between the customer's incident workflow and Cato's Zendesk tickets. The customer ServiceNow administrator selects these values from the target instance's dropdowns. If the customer's labels match the Setup labels, select the matching choices. Custom labels require the incident process owner's confirmation.

### States and hold reasons

The first five dropdowns select **incident states**:

- **New:** the initial state of an eligible incident that creates a linked Zendesk ticket.
- **In Progress:** the working state, corresponding to Zendesk Open.
- **On Hold:** the waiting state. The hold reason below determines what the incident is waiting for.
- **Resolved:** the state corresponding to Zendesk Solved.
- **Closed:** the final state applied when Zendesk closes the linked ticket. Select a different state from Resolved. Customer-originated closure is outside the supported synchronization contract.

The next three dropdowns select **hold reasons**, not additional states:

- **Awaiting Caller:** waiting for the customer or caller. This corresponds to Zendesk Pending.
- **Awaiting Vendor:** waiting for a vendor. This sends Zendesk On-hold.
- **Awaiting Change:** waiting for a change. This also sends Zendesk On-hold.

For example, when a linked Zendesk ticket becomes Pending, Sync Hub sets the incident to the selected **On Hold** state and the selected **Awaiting Caller** reason. When the incident becomes Resolved, Sync Hub sends Solved to Zendesk. In the reverse direction, a Zendesk On-hold change selects **On Hold / Awaiting Vendor**, because Zendesk's status does not distinguish Vendor from Change. Zendesk's optional On-hold status must be enabled for those holds.

### Priority rows 1–5

Each row answers: **which Impact and Urgency inputs produce this ServiceNow priority?** ServiceNow's native rules can calculate priority from those inputs, so inbound updates must use a compatible combination.

For example, **if** High impact plus High urgency produces Priority 1 on this instance, select those choices in row 1. Repeat for priorities 2–5 using the customer's actual rules. Do not assume another instance uses the same combinations. Outbound synchronization reads the incident's resulting priority; these rows supply inputs for inbound priority updates.

The current Cato service translates ServiceNow priorities 1, 2 and 3 to Zendesk Urgent, High and Normal. Both priorities 4 and 5 become Low. A Zendesk Low priority change maps back to ServiceNow priority 4; the two systems do not have the same number of priority levels.

### Resolution code and checking your selections

**Resolution code** is the customer-approved native code Sync Hub supplies when an inbound Solved change resolves the incident. Select a valid choice such as the customer's applicable solved code. Closure preserves an existing resolution code, using this default only if the code is missing.

Keep synchronization paused while configuring. Save and Validate check the selected choices, including distinct state values, but cannot prove that native business rules produce the intended priority or accept every transition. Before production activation, use isolated test records to verify all five priority results and the state/hold examples above with Cato. See the [acceptance checklist](acceptance.md).

## Save, validate and activate

Select **Save** while paused. Save creates/verifies the four physical unique indexes before persisting configuration. A storage or property write failure leaves synchronization paused. Review the saved values and retry before activation. Select **Validate** to check saved settings, credential access, table protections, indexes and Incident auditing. It sends no network or incident probe.

While paused, verify gateway connectivity, OAuth receiver access, Incident/private Table API denial, and all five native priority mappings with isolated test records. Have the Zendesk administrator confirm the optional On-hold status is enabled; Vendor and Change holds require it. See [Zendesk On-hold setup](https://support.zendesk.com/hc/en-us/articles/4408889282458-Adding-the-On-hold-ticket-status-to-Zendesk-Support). Use a separate incident caller and worker identity during acceptance, since native caller replies can reopen an Awaiting Caller incident. Have Cato confirm the matching backend integration and dispatch are ready, coordinate activation on both sides, then confirm those external checks in the form and select **Enable**. Enable revalidates saved settings. Then run the bidirectional tests in the [acceptance checklist](acceptance.md) using eligible New incidents with nonblank titles (at most 160 characters) and descriptions, including dependent choice rules and native audit reason/actor evidence, before production rollout. Pause again if any check fails.

## Upgrades and recovery

Pause capture and hub dispatch, wait for active workers, and back up metadata and the three durable tables. Elevate to `security_admin` and import the reviewed version through the same preview/commit process. Verify the ACLs, end elevation and use ordinary `admin` for Setup. Preserve incident sequences, inbox/outbox rows and delivery identities. The disabled property in the package pauses synchronization after import. Verify it before proceeding.

Use matching sender/gateway versions. The gateway must bind the configured account/integration and implement `syncHub.ingestEvent { event { id result state } }`. Its account argument uses the CMA signed-64-bit `Int!` contract and is emitted as an exact JSON integer.

Active 0.2 marker-based integrations require a separate migration. FAILED and UNCERTAIN inbox rows block later operations on that incident and require investigation. The package has no repair/replay API. Keep tokens, payloads and outbound full-body HTTP logging out of release evidence and normal logs.
