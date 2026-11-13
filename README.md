# Cato ServiceNow setup (sandbox preview)

Reference capture and receiver scripts for synthetic ServiceNow incidents synchronized through Sync Hub. **Draft: licensing unresolved.** This repository does not yet grant an open-source license. Do not distribute it as a licensed release.

**Enable only for the isolated synthetic profile after its acceptance checks.** Version 0.2 moves capture to before rules that abort source writes on outbox failure. Dispatch requires an exact persisted journal row or incident-operation marker/audit entry, so an orphan outbox row cannot prove a source commit. Native source-abort, commit-evidence, restricted OAuth, ordered application, and journal recovery checks passed on the Brazil sandbox. The full vendor round trip and priority-5 fixture remain pending. See the [native acceptance record](docs/native-acceptance.md).

The preview records exact incident revisions and journal rows in an outbox. The customer-owned receiver accepts version-1 deliveries into an inbox before returning HTTP 202; a scheduled processor applies them in sequence. A receiver acknowledgment proves inbox storage, not completed incident application.

```sh
python3 scripts/build-installer.py
npm test
```

Review `build/install.js`, then follow [installation](docs/installation.md). Generated files contain no credentials. Capture is disabled after every installation or upgrade. No external dependency is needed to build or test.

Supported: creation, title, priority, working/hold/resolved states, public comments, outbound private work notes. Description is copied only at creation. Attachments, closure/cancellation, private Zendesk notes, reconciliation, replay APIs, and production deployment are excluded.

Local JavaScript tests cover validation, stable canonical content, ordering, conflict rejection, and recovery after an incident LINK marker commits. They do not establish ServiceNow transaction, business-rule, ACL, OAuth, journal, or physical-index behavior. These require the release acceptance checks in the installation guide.
