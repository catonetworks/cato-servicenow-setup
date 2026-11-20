(function verify() {
    var failures = [];
    function require(value, code) { if (!value) failures.push(code); }
    ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'].forEach(function (table) {
        var row = new GlideRecord(table); require(row.isValid(), 'MISSING_TABLE_' + table);
        var definition = new GlideRecord('sys_db_object');
        require(definition.get('name', table) && ['false', '0'].indexOf(String(definition.getValue('ws_access'))) >= 0, 'TABLE_WEB_SERVICES_ENABLED_' + table);
        var dict = new GlideRecord('sys_dictionary'); dict.addQuery('name', table); dict.addQuery('element', 'u_key'); dict.query();
        require(dict.next() && ['1', 'true'].indexOf(String(dict.getValue('unique'))) >= 0, 'MISSING_UNIQUE_KEY_' + table);
        ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
            var descriptor = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column)); descriptor.setUnique(true);
            require(descriptor.hasIndex(), 'MISSING_PHYSICAL_UNIQUE_' + table + '_' + column);
        });
    });
    require(new GlideRecord('u_cato_sync_state').isValidField('u_create_event'), 'CREATE_RECEIPT_MISSING');
    require(new GlideRecord('u_cato_sync_outbox').isValidField('u_confirmed'), 'SOURCE_RECEIPT_MISSING');
    var inbox = new GlideRecord('u_cato_sync_inbox');
    require(inbox.isValidField('u_effect_claim') && inbox.isValidField('u_journal_id') && inbox.isValidField('u_effect_actor'), 'INBOX_EFFECT_EVIDENCE_MISSING');
    var audit = new GlideRecord('sys_dictionary'); audit.addQuery('name', 'incident'); audit.addNullQuery('element'); audit.query();
    require(audit.next() && ['1', 'true'].indexOf(String(audit.getValue('audit'))) >= 0, 'INCIDENT_AUDIT_DISABLED');
    ['integration_id', 'account_id', 'instance_origin', 'assignment_group', 'gateway_url', 'gateway_credential_id', 'receiver_user', 'state_profile', 'priority_profile', 'resolution_code'].forEach(function (key) {
        require(Boolean(gs.getProperty('cato_sync.' + key, '')), 'MISSING_CONFIG_' + key);
    });
    try { new CatoSyncHub().closedState(JSON.parse(gs.getProperty('cato_sync.state_profile', '{}'))); }
    catch (error) { failures.push('CLOSED_STATE_PROFILE_REQUIRED'); }
    require(['group', 'group-and-title'].indexOf(String(gs.getProperty('cato_sync.capture_mode', 'group-and-title')) || 'group-and-title') >= 0,
        'INVALID_CAPTURE_MODE');
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
    gs.info(JSON.stringify({packageVersion: '0.3.2', release: gs.getProperty('glide.buildname', ''),
        enabled: gs.getProperty('cato_sync.enabled', 'false'), failures: failures,
        remaining: ['Verify physical unique indexes', 'Run rollback/claim/journal/restart acceptance', 'Verify OAuth receiver succeeds and Table API is denied']}));
    if (failures.length) throw new Error('CATO_SYNC_VERIFICATION_FAILED');
})();
