# Building the update-set release

The repository builds a customer-importable, metadata-only XML from `servicenow/update-set-template.xml`. The template is based on a native Zurich Publish to Update Set export with Include demo data cleared. Runtime sources are injected from the reviewed repository at build time. Stable definition sys_ids preserve upgrade identity.

The template includes the application and table shells, dictionary definitions, admin-only CRUD ACLs, Setup-page read ACL and role mappings, and runtime/setup artifacts. It excludes source-instance licensing records, local layouts, crypto caller policies, credentials, identities, runtime rows and configured property values. Setup Save creates and verifies the physical unique indexes on the receiving instance.

1. Run `npm run build` and `npm test`. The build produces `build/cato-sync-hub-<version>.xml`, `SHA256SUMS` and `update-set-manifest.json`.
2. Review the manifest and XML for complete definition/reference coverage. The builder rejects unexpected payload tables, missing ACLs, unsafe properties, missing uniqueness flags and known source-instance references.
3. Import and preview the exact candidate through the native Retrieved Update Sets interface. Record outcomes separately for an existing-install upgrade and a clean target of each release/build being qualified. An existing publisher instance cannot prove a clean installation.
4. Use an installer with `admin` elevated to `security_admin` for import/commit and ACL verification. End elevation, then verify Setup and its actions work with ordinary `admin` and reject non-admin access. Preserve existing durable rows on upgrade and complete bidirectional acceptance. Review custom-table subscription requirements on the receiving instance.
5. Commit/tag the reviewed source and upload the generated XML, checksums, manifest and customer installation guide to a GitHub release. Mark candidates as prereleases while native clean-install or round-trip acceptance remains outstanding. State exactly which checks passed in release notes.

When refreshing the native metadata template, export the complete application with demo data excluded. Keep only the application definitions described above, preserve stable sys_ids, and retain the packaged Setup ACL. Never collect data rows or secrets into the template. The publisher bootstrap remains a maintainer tool for assembling native source metadata.

[ServiceNow application export](https://www.servicenow.com/docs/r/zurich/application-development/t_PublishApplicationsToAnUpdateSet.html)
