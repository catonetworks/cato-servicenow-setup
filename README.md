# Cato Sync Hub for ServiceNow

Bidirectional incident synchronization through Sync Hub. Version 0.4.0 installs a Global application. Native verification is on ServiceNow Zurich; the planned Australia target requires acceptance on its exact build/patch. Licensed under Apache-2.0.

Request Cato-assisted onboarding first: Cato must register the backend integration and provide the integration UUID, account ID, gateway URL and gateway API credential. The customer creates the local ServiceNow references and native mappings. See the value-source table in the installation guide.

Download the versioned update-set XML from [GitHub Releases](https://github.com/catonetworks/cato-servicenow-setup/releases). Use an installer with `admin` elevated to `security_admin`. Import it through Retrieved Update Sets, preview and commit, then end elevation and use ordinary `admin` to open **Cato Sync Hub → Setup** and **Save → Validate → Enable**. The XML includes the application and table definitions. New installations start paused.

The app includes three admin-protected durable tables, source capture rules, the authenticated receiver, scheduled workers, and an administrator setup page. Supported operations include incident creation, title, priority, working/hold/resolved states, Zendesk-driven closure, public comments in both directions, and outbound private work notes. Description is copied at creation. Attachments, customer-originated closure/cancellation, private Zendesk notes, reconciliation and replay APIs are outside the supported contract.

- [Target installation and where every value comes from](docs/installation.md)
- [Cato-side provisioning and customer handoff](docs/cato-provisioning.md)
- [Publisher release procedure](docs/publishing.md)
- [Acceptance checklist](docs/acceptance.md)
- [0.4.0 verification and service compatibility](docs/releases/0.4.0-acceptance.md)

Build with `npm run build` using Python 3. Run the regression suite with `npm test` using Node.js. The build produces the importable XML, SHA-256 checksums and manifest, plus the maintainer bootstrap at `build/install.js`. Candidates with outstanding native clean-install or round-trip checks are published as prereleases.
