const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('sandbox/install-priority-fixture.js', 'utf8');
const group = 'f1c8659dc3a45b50e776b523e4013164';
function install(instance = 'dev467475') {
    const properties = {instance_name: instance, 'cato_sync.assignment_group': group};
    const rule = {};
    const gs = {hasRole: () => true, getProperty: k => properties[k], setProperty: (k,v) => properties[k] = v, info: () => {}};
    const GlideRecord = function(table) {
        this.get = id => table === 'sys_user_group' && id === group;
        this.getValue = () => 'Sync Hub synthetic';
        this.addQuery = this.query = this.initialize = () => {};
        this.next = () => false;
        this.setValue = (k,v) => rule[k] = v;
        this.insert = () => 'fixture';
    };
    vm.runInNewContext(source, {gs, GlideRecord});
    return {gs, properties, rule};
}
test('sandbox priority fixture rejects other instances and runs immediately before capture', () => {
    assert.throws(() => install('production'), /restricted/);
    const {rule} = install();
    assert.equal(rule.order, 999999);
    assert.equal(rule.when, 'before');
    assert.equal(rule.action_insert, true);
    assert.equal(rule.action_update, true);
});
test('only enabled dedicated synthetic incidents receive priority 5; genuine priority 4 is preserved', () => {
    const {gs, properties, rule} = install();
    const base = {assignment_group: group, short_description: '[SYNC-HUB] fixture', impact: '3', urgency: '3', priority: '4'};
    function apply(overrides = {}) {
        const fields = {...base, ...overrides};
        vm.runInNewContext(rule.script, {gs, current: {getValue: k => fields[k], setValue: (k,v) => fields[k] = v}});
        return fields.priority;
    }
    assert.equal(apply(), '5');
    assert.equal(apply({priority: '5'}), '5');
    assert.equal(apply({impact: '2'}), '4');
    assert.equal(apply({assignment_group: 'other'}), '4');
    assert.equal(apply({short_description: 'ordinary incident'}), '4');
    properties['cato_sync.synthetic_priority_five'] = 'false';
    assert.equal(apply(), '4');
    properties['cato_sync.synthetic_priority_five'] = 'true';
    properties.instance_name = 'production';
    assert.equal(apply(), '4');
});
