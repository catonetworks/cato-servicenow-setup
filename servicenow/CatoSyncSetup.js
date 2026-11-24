// Administrator configuration. Secrets remain in native credential records.
var CatoSyncSetup = Class.create();
CatoSyncSetup.prototype = {
    initialize: function () {},
    _admin: function () { if (!gs.hasRole('admin')) throw new Error('Administrator required'); },
    _keys: function () { return ['integration_id', 'account_id', 'instance_origin', 'assignment_group', 'capture_mode', 'title_prefix', 'gateway_url', 'gateway_credential_id', 'receiver_user', 'state_profile', 'priority_profile', 'resolution_code']; },
    _states: function () { return ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'AWAITING_CALLER', 'AWAITING_VENDOR', 'AWAITING_CHANGE']; },
    _read: function () {
        var config = {};
        this._keys().forEach(function (key) { config[key] = String(gs.getProperty('cato_sync.' + key, '')); });
        config.capture_mode = config.capture_mode || 'group-and-title';
        config.title_prefix = config.title_prefix || '[SYNC-HUB]';
        return config;
    },
    _choices: function (element) {
        var choices = [], seen = {};
        ['incident', 'task'].forEach(function (table) {
            var row = new GlideRecordSecure('sys_choice');
            row.addQuery('name', table); row.addQuery('element', element); row.addQuery('language', 'en');
            row.orderBy('sequence'); row.query();
            while (row.next()) {
                var value = String(row.getValue('value'));
                if (Object.prototype.hasOwnProperty.call(seen, value)) continue;
                seen[value] = true;
                if (['true', '1'].indexOf(String(row.getValue('inactive'))) >= 0) continue;
                choices.push({value: value, label: String(row.getValue('label'))});
            }
        });
        return choices;
    },
    view: function () {
        this._admin();
        var config = this._read(), choices = {};
        if (!config.instance_origin) config.instance_origin = String(gs.getProperty('glide.servlet.uri', '')).replace(/\/$/, '');
        ['state', 'hold_reason', 'impact', 'urgency', 'close_code'].forEach(function (field) { choices[field] = this._choices(field); }, this);
        var labels = {};
        [['assignment_group', 'sys_user_group'], ['receiver_user', 'sys_user'], ['gateway_credential_id', 'api_key_credentials']].forEach(function (ref) {
            var row = this._reference(ref[1], config[ref[0]]); labels[ref[0]] = row ? String(row.getDisplayValue()) : '';
        }, this);
        return {config: config, choices: choices, labels: labels, enabled: String(gs.getProperty('cato_sync.enabled', 'false')) === 'true'};
    },
    _reference: function (table, id) {
        if (!/^[a-f0-9]{32}$/.test(id || '')) return null;
        var row = new GlideRecordSecure(table);
        return row.get(id) && ['true', '1'].indexOf(String(row.getValue('active'))) >= 0 ? row : null;
    },
    _configErrors: function (config) {
        var errors = [], self = this, nativeChoices = {};
        ['state', 'hold_reason', 'impact', 'urgency', 'close_code'].forEach(function (element) { nativeChoices[element] = self._choices(element); });
        function check(valid, message) { if (!valid) errors.push(message); }
        this._keys().forEach(function (key) { check(typeof config[key] === 'string' && config[key].length <= 16000, 'Invalid setting: ' + key); });
        if (errors.length) return errors;
        check(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.integration_id), 'Integration ID must be a UUID.');
        check(/^[1-9][0-9]{0,18}$/.test(config.account_id) && (config.account_id.length < 19 || config.account_id <= '9223372036854775807'), 'Account ID must be a positive signed 64-bit integer.');
        check(/^https:\/\/[a-zA-Z0-9.-]+$/.test(config.instance_origin), 'Instance origin must be HTTPS without a path or trailing slash.');
        check(/^https:\/\/[a-zA-Z0-9.-]+\/graphql$/.test(config.gateway_url), 'Gateway URL must be HTTPS and end in /graphql.');
        check(['group', 'group-and-title'].indexOf(config.capture_mode) >= 0, 'Choose a routing mode.');
        check(config.capture_mode !== 'group-and-title' || Boolean(config.title_prefix.trim()), 'Title prefix is required for title filtering.');
        check(Boolean(this._reference('sys_user_group', config.assignment_group)), 'Select an active assignment group.');
        check(Boolean(this._reference('api_key_credentials', config.gateway_credential_id)), 'Select an active API key credential.');
        var user = this._reference('sys_user', config.receiver_user), receiver = false;
        check(Boolean(user), 'Select an active receiver user.');
        if (user) {
            check(['true', '1'].indexOf(String(user.getValue('web_service_access_only'))) >= 0, 'Receiver user must be web-service-only.');
            var roles = new GlideRecordSecure('sys_user_has_role'); roles.addQuery('user', config.receiver_user); roles.query();
            while (roles.next()) {
                var name = String(roles.role.name);
                if (name === 'cato_sync.receiver') receiver = true;
                // Zurich may inherit this additional deny-unless gate through its
                // Conditional Script Writer group; it grants no table/field access.
                else check(name === 'snc_internal' || (name === 'snc_required_script_writer_permission' &&
                    ['true', '1'].indexOf(String(roles.getValue('inherited'))) >= 0), 'Remove receiver role: ' + name);
            }
        }
        check(receiver, 'Receiver user requires cato_sync.receiver.');
        function profile(key) {
            try { var value = JSON.parse(config[key]); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch (error) {}
            errors.push('Enter all mappings for ' + key + '.'); return {};
        }
        function choice(element, value, label) {
            check(value !== undefined && nativeChoices[element].some(function (item) { return item.value === String(value); }), 'Select a valid native choice for ' + label + '.');
        }
        var states = profile('state_profile'), priorities = profile('priority_profile');
        this._states().forEach(function (name) { choice(name.indexOf('AWAITING_') === 0 ? 'hold_reason' : 'state', states[name], name); });
        var stateValues = this._states().slice(0, 5).map(function (name) { return String(states[name]); });
        check(stateValues.every(function (value, index) { return /^-?\d+$/.test(value) && stateValues.indexOf(value) === index; }), 'State mappings must use distinct numeric choices.');
        for (var i = 1; i <= 5; i++) {
            var inputs = priorities[String(i)] || {};
            choice('impact', inputs.impact, 'priority ' + i + ' impact'); choice('urgency', inputs.urgency, 'priority ' + i + ' urgency');
        }
        choice('close_code', config.resolution_code, 'resolution code');
        return errors;
    },
    _metadataErrors: function () {
        var errors = [], definition = new GlideRecordSecure('sys_db_object');
        var appId = definition.get('name', 'u_cato_sync_state') ? String(definition.getValue('sys_package')) : '';
        var app = new GlideRecordSecure('sys_app');
        if (!appId || !app.get(appId) || String(app.getValue('name')) !== 'Cato Sync Hub' || String(app.getValue('scope')) !== 'global')
            errors.push('Private tables must belong to the Cato Sync Hub Global application.');
        var pageAcl = new GlideRecordSecure('sys_security_acl');
        pageAcl.addQuery('name', 'cato_sync_setup'); pageAcl.addQuery('type', 'ui_page');
        pageAcl.addQuery('operation', 'read'); pageAcl.addQuery('active', true); pageAcl.query();
        if (!pageAcl.next()) errors.push('Create the app-owned admin read ACL for the setup page.');
        else {
            var pageRoles = new GlideRecordSecure('sys_security_acl_role'); pageRoles.addQuery('sys_security_acl', pageAcl.getUniqueValue()); pageRoles.query();
            if (String(pageAcl.getValue('sys_package')) !== appId || !pageRoles.next() || String(pageRoles.sys_user_role.name) !== 'admin' || pageRoles.next() || pageAcl.next())
                errors.push('Setup page must have one app-owned admin read ACL.');
        }
        ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'].forEach(function (table) {
            if (!definition.get('name', table) || String(definition.getValue('sys_package')) !== appId || ['false', '0'].indexOf(String(definition.getValue('ws_access'))) < 0)
                errors.push('Check private table ownership and web-service restriction: ' + table);
            ['create', 'read', 'write', 'delete'].forEach(function (operation) {
                var acl = new GlideRecordSecure('sys_security_acl');
                acl.addQuery('name', table); acl.addQuery('type', 'record'); acl.addQuery('operation', operation); acl.addQuery('active', true); acl.query();
                if (!acl.next()) { errors.push('Missing ACL: ' + table + '.' + operation); return; }
                var roles = new GlideRecordSecure('sys_security_acl_role'); roles.addQuery('sys_security_acl', acl.getUniqueValue()); roles.query();
                if (String(acl.getValue('sys_package')) !== appId || !roles.next() || String(roles.sys_user_role.name) !== 'admin' || roles.next() || acl.next())
                    errors.push('Expected one app-owned admin ACL: ' + table + '.' + operation);
            });
            ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
                try {
                    var index = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column)); index.setUnique(true);
                    if (!index.hasIndex()) errors.push('Missing physical unique index: ' + table + '.' + column);
                } catch (error) { errors.push('Cannot verify physical unique index: ' + table + '.' + column); }
            });
        });
        var audit = new GlideRecordSecure('sys_dictionary'); audit.addQuery('name', 'incident'); audit.addNullQuery('element'); audit.query();
        if (!audit.next() || ['true', '1'].indexOf(String(audit.getValue('audit'))) < 0) errors.push('Enable Incident auditing.');
        [['u_cato_sync_state', 'u_create_event'], ['u_cato_sync_outbox', 'u_confirmed'], ['u_cato_sync_inbox', 'u_effect_claim'], ['u_cato_sync_inbox', 'u_journal_id'], ['u_cato_sync_inbox', 'u_effect_actor']].forEach(function (field) {
            if (!new GlideRecordSecure(field[0]).isValidField(field[1])) errors.push('Missing field: ' + field.join('.'));
        });
        return errors;
    },
    _validate: function () {
        var errors = this._configErrors(this._read()).concat(this._metadataErrors());
        try { new CatoSyncHub().gatewayKey(); } catch (error) { errors.push('Gateway credential cannot be read by the runtime.'); }
        return errors;
    },
    _prepareStorage: function () {
        ['u_cato_sync_state', 'u_cato_sync_outbox', 'u_cato_sync_inbox'].forEach(function (table) {
            ['u_key'].concat(table === 'u_cato_sync_inbox' ? ['u_stream_key'] : []).forEach(function (column) {
                if (!gs.ensureIndex(table, column)) throw new Error('Unique index creation failed');
                var index = new GlideIndexDescriptor(table, '', GlideStringUtil.split(column));
                index.setUnique(true);
                if (!index.hasIndex()) throw new Error('Physical unique index missing');
            });
        });
    },
    _write: function (key, value) {
        gs.setProperty('cato_sync.' + key, value);
        if (String(gs.getProperty('cato_sync.' + key, '')) !== value) throw new Error('Configuration write failed');
    },
    execute: function (action, config, confirmed) {
        this._admin();
        var errors = [];
        if (action === 'pause') this._write('enabled', 'false');
        else if (action === 'save') {
            if (String(gs.getProperty('cato_sync.enabled', 'false')) === 'true') return {errors: ['Pause synchronization before saving.']};
            errors = this._configErrors(config || {});
            if (!errors.length) {
                try {
                    this._write('enabled', 'false');
                    this._prepareStorage();
                    this._keys().forEach(function (key) { this._write(key, config[key]); }, this);
                } catch (error) {
                    this._write('enabled', 'false');
                    errors.push('Save failed. Synchronization is paused. Review the settings and save again.');
                }
            }
        } else if (action === 'validate' || action === 'enable') {
            errors = this._validate();
            if (action === 'enable') {
                if (confirmed !== true) errors.push('Confirm the connection and access checks before enabling.');
                if (!errors.length) this._write('enabled', 'true');
            }
        } else errors.push('Unknown setup action.');
        return {errors: errors, enabled: String(gs.getProperty('cato_sync.enabled', 'false')) === 'true', externalChecks: [
            'Verify gateway reachability and account/integration binding from ServiceNow.',
            'Verify OAuth receiver access succeeds and Incident/private Table API access is denied.',
            'Verify native priority derivation for all five mappings and audit evidence with isolated test records.'
        ]};
    },
    type: 'CatoSyncSetup'
};
