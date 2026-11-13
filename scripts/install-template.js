(function install() {
    if (!gs.hasRole('admin') || !gs.hasRole('security_admin')) throw new Error('Elevated setup administrator required');
    var sources = /* SOURCES */;
    function upsert(table, keys, values) {
        var row = new GlideRecord(table);
        Object.keys(keys).forEach(function (key) { row.addQuery(key, keys[key]); });
        row.query(); var exists = row.next();
        if (!exists) row.initialize();
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
    upsert('sys_properties', {name: 'cato_sync.enabled'}, {value: 'false', type: 'boolean', description: 'Capture and delivery enabled only after sandbox verification'});
    var receiverRole = upsert('sys_user_role', {name: 'cato_sync.receiver'}, {description: 'Invoke the owned-incident Cato receiver; no table privileges'});
    var adminRole = new GlideRecord('sys_user_role');
    if (!adminRole.get('name', 'admin')) throw new Error('Admin role missing');
    var tables = ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'];
    tables.forEach(function (table) {
        upsert('sys_db_object', {name: table}, {label: table.replace(/_/g, ' '), is_extendable: false});
        field(table, 'u_key', 'string', 200, true);
        if (table === 'u_cato_sync_state') {
            field(table, 'u_next_sequence', 'integer'); field(table, 'u_ticket_id', 'string', 40);
        } else {
            field(table, 'u_record', 'string', 32); field(table, 'u_payload', 'string', 262144);
            field(table, 'u_state', 'string', 24); field(table, 'u_attempts', 'integer');
            field(table, 'u_claim', 'string', 32); field(table, 'u_lease_until', 'glide_date_time');
            field(table, 'u_next_attempt', 'glide_date_time'); field(table, 'u_error', 'string', 80);
            if (table === 'u_cato_sync_inbox') { field(table, 'u_stream_key', 'string', 80, true); field(table, 'u_sequence', 'integer'); }
            if (table === 'u_cato_sync_outbox') field(table, 'u_proof_kind', 'string', 24);
        }
        ['create', 'read', 'write', 'delete'].forEach(function (operation) {
            var acl = upsert('sys_security_acl', {name: table, operation: operation, type: 'record'},
                {active: true, admin_overrides: true, script: 'answer = gs.hasRole("admin");'});
            upsert('sys_security_acl_role', {sys_security_acl: acl, sys_user_role: String(adminRole.getUniqueValue())}, {});
        });
    });
    tables.forEach(function (table) {
        ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
            if (!gs.ensureIndex(table, column)) throw new Error('Unique index creation failed: ' + table + '.' + column);
            var descriptor = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column));
            descriptor.setUnique(true);
            if (!descriptor.hasIndex()) throw new Error('Physical unique index missing: ' + table + '.' + column);
        });
    });
    field('incident', 'u_cato_sync_last_delivery', 'string', 36);
    field('incident', 'u_cato_sync_source_event', 'string', 80);
    field('incident', 'u_cato_sync_created_event', 'string', 80);
    var incidentDictionary = new GlideRecord('sys_dictionary');
    incidentDictionary.addQuery('name', 'incident'); incidentDictionary.addNullQuery('element'); incidentDictionary.query();
    if (!incidentDictionary.next() || ['true', '1'].indexOf(String(incidentDictionary.getValue('audit'))) < 0)
        throw new Error('Incident auditing must be enabled before installing commit-evidence capture');
    field('sys_journal_field', 'u_cato_sync_effect_key', 'string', 36);
    ['incident.u_cato_sync_last_delivery', 'incident.u_cato_sync_source_event', 'incident.u_cato_sync_created_event', 'sys_journal_field.u_cato_sync_effect_key'].forEach(function (name) {
        ['create', 'write'].forEach(function (operation) {
            var acl = upsert('sys_security_acl', {name: name, operation: operation, type: 'record'},
                {active: true, admin_overrides: true, script: 'answer = gs.hasRole("admin");'});
            upsert('sys_security_acl_role', {sys_security_acl: acl, sys_user_role: String(adminRole.getUniqueValue())}, {});
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
    rule('Cato Sync journal effect v1', 'sys_journal_field', 'before', true, false, 50, 'journal-marker-rule.js');
    rule('Cato Sync journal capture v1', 'sys_journal_field', 'before', true, false, 1000000, 'journal-rule.js');
    var api = upsert('sys_ws_definition', {service_id: 'cato_sync'}, {name: 'Cato Sync sandbox receiver', active: true, namespace: 'global'});
    upsert('sys_ws_operation', {web_service_definition: api, name: 'Receive v1'}, {
        http_method: 'POST', relative_path: '/v1/receive', active: true, requires_authentication: true,
        requires_acl_authorization: false, operation_script: sources['receiver.js']
    });
    ['dispatch', 'processInbox'].forEach(function (method) {
        upsert('sysauto_script', {name: 'Cato Sync ' + method + ' v1'}, {active: true, run_type: 'periodically',
            run_period: '1970-01-01 00:00:05', script: 'new CatoSyncHub().' + method + '();'});
    });
    upsert('sys_properties', {name: 'cato_sync.package_version'}, {value: '0.2.0', type: 'string'});
    gs.info('Cato Sync 0.2.0 installed DISABLED. Verify source abort and commit evidence before enabling.');
})();
