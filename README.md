# Cato ServiceNow setup

Capture and receiver scripts for ServiceNow incidents synchronized through Sync Hub. Licensed under the [Apache License, Version 2.0](LICENSE). Installation starts disabled. Validate the target ServiceNow release and routing group before rollout.

Version 0.3 targets an ordinary-admin install of a Global application on Zurich. The publisher uses ServiceNow's table creation controls to generate admin-only table ACLs. The runtime keeps source receipts, claims and journal IDs in the three protected application tables. The package adds no fields or ACLs to Incident or Journal Entry.

The ServiceNow receiver accepts version-1 deliveries into an inbox before returning HTTP 202. A scheduled processor applies them in sequence. The acknowledgment covers inbox storage. Application is recorded separately.

```sh
npm run build
npm test
```

[Build the Global application and install it from the Application Repository](docs/installation.md). `build/install.js` is a publisher bootstrap. The application is disabled at first install. Use a dedicated synthetic profile for acceptance. See the [prior native acceptance record](docs/native-acceptance.md) for version 0.2 results.

Supported: creation, title, priority, working/hold/resolved states, inbound Zendesk closure, public comments, outbound private work notes. Description is copied only at creation. Attachments, customer-originated closure/cancellation, private Zendesk notes, reconciliation, replay APIs, and production deployment are excluded.

Local JavaScript tests cover envelope validation, sequence advancement, exact journal recovery, stale-claim rejection, and PATCH audit matching. The installation guide defines the native release checks.
