var catoSetupKeys = ['integration_id', 'account_id', 'instance_origin', 'assignment_group', 'capture_mode', 'title_prefix', 'gateway_url', 'gateway_credential_id', 'receiver_user', 'resolution_code'];
var catoSetupStates = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'AWAITING_CALLER', 'AWAITING_VENDOR', 'AWAITING_CHANGE'];
var catoSetupEnabled = false;
function catoSetupBusy(busy) {
    ['save', 'validate', 'enable', 'pause'].forEach(function (id) { document.getElementById(id).disabled = busy; });
    document.getElementById('sync-fields').disabled = busy || catoSetupEnabled;
}
function catoSetupCall(action, config, callback) {
    catoSetupBusy(true);
    var ajax = new GlideAjax('CatoSyncSetupAjax');
    ajax.addParam('sysparm_name', 'execute');
    ajax.addParam('sysparm_action', action);
    ajax.addParam('sysparm_config', JSON.stringify(config || {}));
    ajax.addParam('sysparm_confirmed', String(document.getElementById('external-checks').checked));
    ajax.getXMLAnswer(function (answer) {
        try {
            var result = JSON.parse(answer);
            if (!result || typeof result !== 'object') throw new Error('Missing response');
            callback(result);
        } catch (error) {
            document.getElementById('setup-results').textContent = 'Unable to complete setup. Reload to check the saved configuration and synchronization status.';
            return; // Keep controls disabled until saved state is known.
        }
        catoSetupBusy(false);
    });
}
function catoSetupSelect(id, choices, selected) {
    var select = document.getElementById(id);
    select.textContent = '';
    select.add(new Option('Select a value', ''));
    choices.forEach(function (choice) { select.add(new Option(choice.label, choice.value)); });
    if (selected !== undefined && selected !== '' && !choices.some(function (choice) { return choice.value === String(selected); }))
        select.add(new Option('Unavailable saved value (' + selected + ')', String(selected)));
    select.value = selected === undefined ? '' : String(selected);
}
function catoSetupLoad() {
    catoSetupCall('load', {}, function (model) {
        if (!model.config) throw new Error('Configuration unavailable');
        var config = model.config, states = {}, priorities = {};
        try { states = JSON.parse(config.state_profile) || {}; } catch (error) {}
        try { priorities = JSON.parse(config.priority_profile) || {}; } catch (error) {}
        catoSetupKeys.forEach(function (key) { document.getElementById(key).value = config[key]; });
        Object.keys(model.labels).forEach(function (key) {
            var display = document.getElementById('sys_display.' + key);
            if (display) display.value = model.labels[key];
        });
        catoSetupStates.forEach(function (key) { catoSetupSelect('state_' + key, model.choices[key.indexOf('AWAITING_') === 0 ? 'hold_reason' : 'state'], states[key]); });
        for (var i = 1; i <= 5; i++) {
            var inputs = priorities[String(i)] || {};
            catoSetupSelect('impact_' + i, model.choices.impact, inputs.impact);
            catoSetupSelect('urgency_' + i, model.choices.urgency, inputs.urgency);
        }
        catoSetupSelect('resolution_code', model.choices.close_code, config.resolution_code);
        catoSetupEnabled = model.enabled;
        document.getElementById('sync-status').textContent = model.enabled ? 'Synchronization enabled' : 'Synchronization paused';
    });
}
function catoSetupAction(action) {
    var config = {}, states = {}, priorities = {};
    catoSetupKeys.forEach(function (key) { config[key] = document.getElementById(key).value; });
    catoSetupStates.forEach(function (key) { states[key] = document.getElementById('state_' + key).value; });
    for (var i = 1; i <= 5; i++) priorities[String(i)] = {impact: document.getElementById('impact_' + i).value, urgency: document.getElementById('urgency_' + i).value};
    config.state_profile = JSON.stringify(states); config.priority_profile = JSON.stringify(priorities);
    catoSetupCall(action, config, function (result) {
        if (typeof result.enabled === 'boolean') catoSetupEnabled = result.enabled;
        document.getElementById('sync-status').textContent = catoSetupEnabled ? 'Synchronization enabled' : 'Synchronization paused';
        var output = document.getElementById('setup-results'); output.textContent = '';
        var messages = result.errors.length ? result.errors : [action === 'validate' ? 'Saved configuration passed metadata checks.' : 'Action completed.'];
        messages.concat(result.externalChecks || []).forEach(function (message) { var p = document.createElement('p'); p.textContent = message; output.appendChild(p); });
        if (action === 'save') document.getElementById('external-checks').checked = false;
    });
}
addLoadEvent(function () { if (document.getElementById('sync-fields')) catoSetupLoad(); });
