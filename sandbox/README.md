# Approved development-instance priority fixture

The native priority matrix in `dev467475` maps impact 3 / urgency 3 to priority 4. To exercise the required priority-5 echo behavior, run `install-priority-fixture.js` as the sandbox administrator after installing the main package and configuring the dedicated synthetic group.

This optional fixture is separate from `build/install.js`. It refuses other instances and requires the existing `Sync Hub synthetic` group and matching capture property. Its before rule runs at order 999999, immediately before capture. At runtime it requires the same instance, that exact group, a title starting with `[SYNC-HUB]`, and `cato_sync.synthetic_priority_five=true`. Only impact 3 / urgency 3 is changed to priority 5. A genuine priority-4 update uses impact 2 / urgency 3 and remains 4. The shared priority matrix is unchanged.

To disable the fixture, set `cato_sync.synthetic_priority_five=false` or deactivate `Cato Sync sandbox priority 5 fixture`. Existing records retain their current priority until another normal update recalculates it. Never install this fixture in a customer or production instance.

Local tests cover instance/group/title/enabled isolation and priorities 4/5. Native installation and acceptance results belong in `docs/native-acceptance.md` after execution.
