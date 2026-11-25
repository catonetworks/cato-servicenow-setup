# Cato-side provisioning and customer handoff

Applies to the ServiceNow 0.4.0 installer. This checklist is for the Cato operator coordinating deployment, Zendesk administration and customer onboarding. It does not perform provisioning or define a new public API.

## Current delivery boundary

The XML installs the ServiceNow application only. There is no customer-facing Cato setup screen or integration-registration API in the current implementation. The service has ingestion, status and vendor callback paths; those paths do not create integration configuration. The available local seeding utility is a test/development tool, not a supported managed-production provisioning runbook.

The steps below are **required Cato operator work and readiness evidence**. Cato must use an approved environment-specific deployment/registration procedure to carry them out. Managed registration automation, approved gateway identity wiring, rollout-tag/RBAC identifiers, ingress and secret configuration must be supplied and verified for the deployment. Do not direct a customer to a nonexistent UI, invent a registration endpoint, or describe the XML import as completing this work. If the approved managed procedure is unavailable, customer activation is blocked and both sides remain paused.

## 1. Open the onboarding record

Record the customer administrator, Cato rollout owner, intended environment, actual numeric account ID and canonical ServiceNow HTTPS origin. Verify that the customer is authorized for that account and the requested connection. Check commercial-account eligibility and the approved rollout gate; restricted accounts must remain disabled. Resolve the registered gate and permissions with the owning platform team rather than inventing identifiers.

Confirm the customer installer has `admin` and can elevate to `security_admin` for XML import and ACL verification. Routine Setup actions require ordinary `admin`; the dedicated receiver must never receive either administrative role. Record the target ServiceNow release and patch, and arrange acceptance on that exact build (Australia qualification is still pending; existing 0.4.0 native evidence is from Zurich). Tell the customer to import the XML while paused. The receiver role and endpoint must exist before the customer can finish preparing the dedicated receiver user and OAuth application. Cato can prepare its gateway and Zendesk configuration in parallel.

## 2. Collect the customer-owned receiver details

Obtain the canonical ServiceNow origin and the receiver URL formed by appending `/api/global/cato_sync/v1/receive`. Obtain the token endpoint, agreed OAuth grant, client ID and necessary confidential OAuth material through the approved secure channel. Verify that authorization is bound to the selected active web-service-only receiver user and intended scope, with receiver invocation permitted and Incident/private Table APIs denied.

Cato must not collect the customer’s administrator password or use the ServiceNow Table API as the delivery path. The API key credential selected in ServiceNow is for the opposite direction and cannot replace receiver OAuth.

## 3. Register the integration, initially disabled

Through the approved Cato operator registration procedure, generate a new UUID and persist the account/integration relationship and initial immutable mapping revision. Bind it to the exact customer ServiceNow origin and receiver URL, approved Zendesk tenant, requester/organization/team/form/defaults, sharing rules, callback verification material and account/environment-bound credential references. Record the resulting integration UUID in the onboarding record.

**Generate and register are one provisioning step.** A UUID copied into the customer form without the corresponding backend integration and mapping cannot authorize or route synchronization. Preserve an existing integration ID on upgrades; never replace it just to refresh configuration. Follow the service’s immutable mapping/version rules for changes and retain accepted work.

The customer needs this Sync Hub integration UUID. It is different from the account ID, the OAuth client ID, any ServiceNow record sys_id and the Zendesk ZIS integration name.

## 4. Prepare the gateway, runtime and secret bindings

Deploy a compatible gateway/service pair, including the rapid independent resolution/closure fix referenced in the 0.4.0 acceptance report. Confirm that the managed gateway binds the authenticated credential to the actual account and the required ingestion/status permissions. Validate the gateway’s issuer/audience/subject and signed account/scope contract with its owner. A working local test key or a generally valid CMA key does not prove that managed gateway binding.

Store Zendesk runtime OAuth and customer receiver OAuth material in AWS Systems Manager Parameter Store as SecureString values encrypted with the approved KMS key, using the service’s account/integration/environment binding. Confirm the workload’s access to the exact required parameters. Keep provisioning administration credentials separate from runtime credentials. Verify storage, queues, TLS/DNS/egress, callback ingress and operational monitoring in the target environment. Start with the integration and dispatch disabled.

Arrange the gateway API credential that the customer will use for outbound calls. Record its owner, account binding and approved secure delivery channel; do not include its secret value in the ordinary onboarding record.

## 5. Configure the Cato-owned Zendesk side

Confirm the correct Zendesk organization, requester, Support group, form, required creation defaults and visibility policy. Enable optional On-hold status for Vendor/Change holds. Configure the approved runtime OAuth credential and the selected notification transport.

For the ZIS path used in acceptance, register/select the Cato-owned ZIS integration, pin its verification public key to the intended tenant/integration mapping, prepare the five filtered ticket jobs and the trusted HTTPS callback URL, and include only the intended Sync Hub integration IDs. Check filtering, account/ticket ownership and public-comment visibility before activation. Keep an alternative notification transport inactive so the rollout does not create competing delivery paths. The ZIS integration name/public key and Zendesk runtime credentials stay on the Cato side; they are not Setup values for the customer.

## 6. Give the customer a completed connection handoff

| Item | Where Cato gets it | What the customer does |
| --- | --- | --- |
| Registered Sync Hub integration UUID | Result of step 3, persisted under this customer account | Copies it into Integration UUID. |
| Numeric Cato account ID | Verified customer account selected in step 1 | Copies it into Cato account ID exactly. |
| HTTPS gateway GraphQL URL | Approved deployed gateway from step 4 | Copies the full endpoint ending `/graphql`. |
| Gateway API key | Approved account-bound gateway credential from step 4 | Receives the secret securely, creates a native API Key Credential, and selects that record. |
| Confirmed ServiceNow origin and receiver URL | Customer’s canonical target origin and installed receiver | Reviews the prefilled origin; confirms it matches Cato’s registration. |
| Compatible versions, readiness and rollout owner | Deployment/validation record from steps 4–5 | Keeps Setup paused until joint checks and coordinated activation. |

Provide the [customer installation guide](installation.md) and the versioned GitHub release link. Confirm the customer can access the approved release; arrange an authorized distribution route if repository access is unavailable. Transmit secrets separately using the agreed secure channel. The customer should not need a Cato database ID lookup, a UUID generator or a Cato-side command line to fill the form.

## 7. Validate jointly, then activate both sides

Ask the customer to select their own assignment group, routing mode/title filter, receiver user and native mappings using the value-source table in the installation guide. Save and Validate on ServiceNow must pass. Verify real gateway account/integration binding, receiver OAuth invocation and Table API denials, all five native priority derivations, and Zendesk On-hold availability. ServiceNow’s metadata Validate cannot prove those external checks.

Coordinate readiness of the Cato integration, rollout gate, dispatch and notification jobs before the customer selects Enable. Run isolated creation/linking, fields, holds, resolution/closure, comments, private work notes and retry/duplicate checks. Record the compatible versions and outcome without secrets or customer payloads. Pause on either side if acceptance fails; retain queues, links, sequence numbers and failed/uncertain evidence. Customer production activation requires the managed environment’s own acceptance, beyond the reference-installation test.
