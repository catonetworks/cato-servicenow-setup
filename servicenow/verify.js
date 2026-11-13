(function verify() {
    var failures = [];
    function require(value, code) { if (!value) failures.push(code); }
    ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'].forEach(function (table) {
        var row = new GlideRecord(table); require(row.isValid(), 'MISSING_TABLE_' + table);
        var dict = new GlideRecord('sys_dictionary'); dict.addQuery('name', table); dict.addQuery('element', 'u_key'); dict.query();
        require(dict.next() && ['1', 'true'].indexOf(String(dict.getValue('unique'))) >= 0, 'MISSING_UNIQUE_KEY_' + table);
        ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
            var descriptor = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column)); descriptor.setUnique(true);
            require(descriptor.hasIndex(), 'MISSING_PHYSICAL_UNIQUE_' + table + '_' + column);
        });
    });
    var incident = new GlideRecord('incident');
    require(incident.isValidField('u_cato_sync_source_event') && incident.isValidField('u_cato_sync_created_event'), 'COMMIT_MARKERS_MISSING');
    var audit = new GlideRecord('sys_dictionary'); audit.addQuery('name', 'incident'); audit.addNullQuery('element'); audit.query();
    require(audit.next() && ['1', 'true'].indexOf(String(audit.getValue('audit'))) >= 0, 'INCIDENT_AUDIT_DISABLED');
    ['integration_id', 'account_id', 'instance_origin', 'assignment_group', 'gateway_url', 'gateway_credential_id', 'receiver_user', 'state_profile', 'priority_profile', 'resolution_code'].forEach(function (key) {
        require(Boolean(gs.getProperty('cato_sync.' + key, '')), 'MISSING_CONFIG_' + key);
    });
    try { require(Boolean(new CatoSyncHub().gatewayKey()), 'GATEWAY_CREDENTIAL_UNAVAILABLE'); }
    catch (error) { failures.push('GATEWAY_CREDENTIAL_UNAVAILABLE'); }
    var user = new GlideRecord('sys_user');
    require(user.get(gs.getProperty('cato_sync.receiver_user', '')), 'RECEIVER_USER_MISSING');
    if (user.isValidRecord()) {
        require(String(user.getValue('web_service_access_only')) === '1', 'RECEIVER_NOT_WEB_SERVICE_ONLY');
        var roles = new GlideRecord('sys_user_has_role'); roles.addQuery('user', user.getUniqueValue()); roles.query();
        var receiver = false;
        while (roles.next()) {
            var name = String(roles.role.name);
            if (name === 'cato_sync.receiver') receiver = true;
            else if (name !== 'snc_internal') failures.push('RECEIVER_EXTRA_ROLE');
        }
        require(receiver, 'RECEIVER_ROLE_MISSING');
    }
    require(String(gs.getProperty('glide.buildname', '')) !== '', 'RELEASE_UNKNOWN');
    gs.info(JSON.stringify({packageVersion: '0.2.0', release: gs.getProperty('glide.buildname', ''),
        enabled: gs.getProperty('cato_sync.enabled', 'false'), failures: failures,
        remaining: ['Verify physical unique indexes', 'Run rollback/claim/journal/restart acceptance', 'Verify OAuth receiver succeeds and Table API is denied']}));
    if (failures.length) throw new Error('CATO_SYNC_VERIFICATION_FAILED');
})();
