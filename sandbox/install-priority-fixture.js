(function installSyntheticPriorityFixture() {
    var groupId = 'f1c8659dc3a45b50e776b523e4013164';
    if (!gs.hasRole('admin') || gs.getProperty('instance_name') !== 'dev467475')
        throw new Error('This fixture is restricted to the approved development instance');
    var group = new GlideRecord('sys_user_group');
    if (!group.get(groupId) || String(group.getValue('name')) !== 'Sync Hub synthetic'
            || gs.getProperty('cato_sync.assignment_group') !== groupId)
        throw new Error('Dedicated synthetic group does not match');

    function applySyntheticPriority(current) {
        if (gs.getProperty('instance_name') !== 'dev467475'
                || gs.getProperty('cato_sync.synthetic_priority_five') !== 'true'
                || String(current.getValue('assignment_group')) !== 'f1c8659dc3a45b50e776b523e4013164'
                || String(current.getValue('short_description')).indexOf('[SYNC-HUB]') !== 0) return;
        if (String(current.getValue('impact')) === '3' && String(current.getValue('urgency')) === '3')
            current.setValue('priority', '5');
    }
    var rule = new GlideRecord('sys_script');
    rule.addQuery('name', 'Cato Sync sandbox priority 5 fixture');
    rule.addQuery('collection', 'incident');
    rule.query();
    var exists = rule.next();
    if (!exists) rule.initialize();
    var values = {name: 'Cato Sync sandbox priority 5 fixture', collection: 'incident',
        active: true, advanced: true, when: 'before', order: 999999,
        action_insert: true, action_update: true, action_delete: false, action_query: false,
        script: '(' + applySyntheticPriority.toString() + ')(current);'};
    Object.keys(values).forEach(function (key) { rule.setValue(key, values[key]); });
    if (!(exists ? rule.update() : rule.insert())) throw new Error('Fixture rule write failed');
    gs.setProperty('cato_sync.synthetic_priority_five', 'true');
    gs.info('Isolated priority-5 fixture installed. Shared priority matrix unchanged.');
})();
