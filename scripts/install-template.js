// SPDX-License-Identifier: Apache-2.0
// License: https://www.apache.org/licenses/LICENSE-2.0
(function install() {
    if (!gs.hasRole('admin')) throw new Error('Setup administrator required');
    var definition = new GlideRecord('sys_db_object');
    if (!definition.get('name', 'u_cato_sync_state')) throw new Error('Create the private application tables first');
    var appId = String(definition.getValue('sys_package') || '');
    var app = new GlideRecord('sys_app');
    if (!/^[a-f0-9]{32}$/.test(appId) || !app.get(appId) || String(app.getValue('name')) !== 'Cato Sync Hub' || String(app.getValue('scope')) !== 'global')
        throw new Error('The private tables must belong to the Cato Sync Hub Global application');
    var sources = /* SOURCES */;
    function upsert(table, keys, values) {
        var row = new GlideRecord(table);
        Object.keys(keys).forEach(function (key) { row.addQuery(key, keys[key]); });
        row.query(); var exists = row.next();
        if (!exists) {
            row.initialize();
            if (row.isValidField('sys_package')) row.setValue('sys_package', appId);
            if (row.isValidField('sys_scope')) row.setValue('sys_scope', appId);
        } else if (row.isValidField('sys_package') && String(row.getValue('sys_package')) !== appId) {
            throw new Error('Metadata already owned by another application: ' + table);
        }
        Object.keys(keys).concat(Object.keys(values)).forEach(function (key) {
            if (!row.isValidField(key)) throw new Error('Unsupported release field: ' + table + '.' + key);
            row.setValue(key, Object.prototype.hasOwnProperty.call(values, key) ? values[key] : keys[key]);
        });
        var id = exists ? row.update() : row.insert();
        if (!id) throw new Error('Metadata write failed: ' + table);
        return String(id);
    }
    function field(table, name, type, length, unique) {
        return upsert('sys_dictionary', {name: table, element: name}, {
            internal_type: type, column_label: name.replace(/^u_/, '').replace(/_/g, ' '),
            max_length: length || 40, unique: Boolean(unique), active: true
        });
    }
    var tables = ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'];
    var ruledIncident = new GlideRecord('incident');
    if (ruledIncident.isValidField('u_cato_sync_source_event') || new GlideRecord('sys_journal_field').isValidField('u_cato_sync_effect_key'))
        throw new Error('The marker-based preview requires a separate migration');
    tables.forEach(function (table) {
        var definition = new GlideRecord('sys_db_object');
        if (!definition.get('name', table) || String(definition.getValue('sys_package')) !== appId
            || ['false', '0'].indexOf(String(definition.getValue('ws_access'))) < 0)
            throw new Error('Create the private table in the Cato Sync Hub application with web services disabled: ' + table);
        ['create', 'read', 'write', 'delete'].forEach(function (operation) {
            var acl = new GlideRecord('sys_security_acl');
            acl.addQuery('name', table); acl.addQuery('operation', operation); acl.addQuery('type', 'record');
            acl.addQuery('active', true); acl.query();
            if (!acl.next() || String(acl.getValue('sys_package')) !== appId)
                throw new Error('Generated table ACL missing: ' + table + '.' + operation);
            var role = new GlideRecord('sys_security_acl_role');
            role.addQuery('sys_security_acl', String(acl.getUniqueValue())); role.query();
            if (!role.next() || String(role.sys_user_role.name) !== 'admin' || role.next() || acl.next())
                throw new Error('Expected a single platform-generated admin ACL: ' + table + '.' + operation);
        });
    });
    var incidentDictionary = new GlideRecord('sys_dictionary');
    incidentDictionary.addQuery('name', 'incident'); incidentDictionary.addNullQuery('element'); incidentDictionary.query();
    if (!incidentDictionary.next() || ['true', '1'].indexOf(String(incidentDictionary.getValue('audit'))) < 0)
        throw new Error('Incident auditing is required for PATCH recovery');
    upsert('sys_properties', {name: 'cato_sync.enabled'}, {value: 'false', type: 'boolean', description: 'Enable Sync Hub after acceptance'});
    upsert('sys_user_role', {name: 'cato_sync.receiver'}, {description: 'Invoke the owned-incident Cato receiver; no table privileges'});
    tables.forEach(function (table) {
        field(table, 'u_key', 'string', 200, true);
        if (table === 'u_cato_sync_state') {
            field(table, 'u_next_sequence', 'integer'); field(table, 'u_ticket_id', 'string', 40);
            field(table, 'u_create_event', 'string', 80);
        } else {
            field(table, 'u_record', 'string', 32); field(table, 'u_payload', 'string', 262144);
            field(table, 'u_state', 'string', 24); field(table, 'u_attempts', 'integer');
            field(table, 'u_claim', 'string', 32); field(table, 'u_lease_until', 'glide_date_time');
            field(table, 'u_next_attempt', 'glide_date_time'); field(table, 'u_error', 'string', 80);
            if (table === 'u_cato_sync_inbox') {
                field(table, 'u_stream_key', 'string', 80, true); field(table, 'u_sequence', 'integer');
                field(table, 'u_effect_claim', 'string', 32); field(table, 'u_journal_id', 'string', 32);
                field(table, 'u_effect_actor', 'string', 100);
            } else {
                field(table, 'u_proof_kind', 'string', 24); field(table, 'u_confirmed', 'boolean');
                field(table, 'u_revision', 'integer');
            }
        }
    });
    tables.forEach(function (table) {
        ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
            if (!gs.ensureIndex(table, column)) throw new Error('Unique index creation failed: ' + table + '.' + column);
            var descriptor = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column));
            descriptor.setUnique(true);
            if (!descriptor.hasIndex()) throw new Error('Physical unique index missing: ' + table + '.' + column);
        });
    });
    ['CatoSyncRules', 'CatoSyncHub'].forEach(function (name) {
        upsert('sys_script_include', {name: name}, {script: sources[name + '.js'], active: true, client_callable: false, access: 'package_private'});
    });
    function rule(name, table, when, insert, update, order, filename) {
        upsert('sys_script', {name: name, collection: table}, {active: true, advanced: true, when: when,
            action_insert: insert, action_update: update, action_delete: false, action_query: false, order: order, script: sources[filename]});
    }
    rule('Cato Sync incident capture v1', 'incident', 'before', true, true, 1000000, 'incident-rule.js');
    rule('Cato Sync incident receipt v1', 'incident', 'after', true, true, 50, 'incident-confirm-rule.js');
    rule('Cato Sync journal capture v1', 'sys_journal_field', 'before', true, false, 1000000, 'journal-rule.js');
    // Create the UI page's admin read ACL with native controls before publication.
    upsert('sys_script_include', {name: 'CatoSyncSetup'}, {script: sources['CatoSyncSetup.js'], active: true, client_callable: false, access: 'package_private'});
    upsert('sys_script_include', {name: 'CatoSyncSetupAjax'}, {script: sources['CatoSyncSetupAjax.js'], active: true, client_callable: true, access: 'package_private'});
    upsert('sys_ui_page', {name: 'cato_sync_setup'}, {html: sources['setup-page.xml'], client_script: sources['setup-client.js'], processing_script: '', direct: false});
    var menu = upsert('sys_app_application', {title: 'Cato Sync Hub'}, {active: true, roles: 'admin'});
    upsert('sys_app_module', {application: menu, title: 'Setup'}, {active: true, roles: 'admin', link_type: 'DIRECT', query: 'cato_sync_setup.do'});
    var api = upsert('sys_ws_definition', {service_id: 'cato_sync'}, {name: 'Cato Sync Hub receiver', active: true, namespace: 'global'});
    upsert('sys_ws_operation', {web_service_definition: api, name: 'Receive v1'}, {
        http_method: 'POST', relative_path: '/v1/receive', active: true, requires_authentication: true,
        requires_acl_authorization: false, operation_script: sources['receiver.js']
    });
    ['dispatch', 'processInbox'].forEach(function (method) {
        upsert('sysauto_script', {name: 'Cato Sync ' + method + ' v1'}, {active: true, run_type: 'periodically',
            run_period: '1970-01-01 00:00:05', script: 'new CatoSyncHub().' + method + '();'});
    });
    upsert('sys_properties', {name: 'cato_sync.package_version'}, {value: '0.4.0', type: 'string'});
    gs.info('Cato Sync 0.4.0 installed DISABLED. Verify source abort and commit evidence before enabling.');
})();
