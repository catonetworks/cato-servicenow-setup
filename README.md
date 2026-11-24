# Cato Sync Hub for ServiceNow

Bidirectional incident synchronization through Sync Hub. Version 0.4.0 targets a Global application on ServiceNow Zurich. Licensed under Apache-2.0.

Download the versioned update-set XML from [GitHub Releases](https://github.com/catonetworks/cato-servicenow-setup/releases). Import it through Retrieved Update Sets, preview and commit, then open **Cato Sync Hub → Setup** and **Save → Validate → Enable**. The XML includes the application and table definitions. New installations start paused.

The app includes three admin-protected durable tables, source capture rules, the authenticated receiver, scheduled workers, and an administrator setup page. Supported operations include incident creation, title, priority, working/hold/resolved states, Zendesk-driven closure, public comments in both directions, and outbound private work notes. Description is copied at creation. Attachments, customer-originated closure/cancellation, private Zendesk notes, reconciliation and replay APIs are outside the supported contract.

- [Target installation](docs/installation.md)
- [Publisher release procedure](docs/publishing.md)
- [Acceptance checklist](docs/acceptance.md)
- [0.4.0 verification and service compatibility](docs/releases/0.4.0-acceptance.md)

Build with `npm run build` using Python 3. Run the regression suite with `npm test` using Node.js. The build produces the importable XML, SHA-256 checksums and manifest, plus the maintainer bootstrap at `build/install.js`. Candidates with outstanding native clean-install or round-trip checks are published as prereleases.
