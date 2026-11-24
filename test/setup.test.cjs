const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(properties = {}, admin = true) {
  const writes = [];
  const context = vm.createContext({
    Class: {create: () => function () {}},
    gs: {
      hasRole: () => admin,
      getProperty: (key, fallback) => Object.hasOwn(properties, key) ? properties[key] : fallback,
      setProperty: (key, value) => { writes.push(key); properties[key] = value; }
    },
    CatoSyncHub: function () { this.gatewayKey = () => 'credential-available'; }
  });
  vm.runInContext(fs.readFileSync('servicenow/CatoSyncSetup.js', 'utf8'), context);
  const service = new context.CatoSyncSetup();
  service._choices = element => {
    const values = {state: ['1', '2', '3', '6', '7'], hold_reason: ['1', '4', '5'], impact: ['1', '2', '3'], urgency: ['1', '2', '3'], close_code: ['resolved']};
    return values[element].map(value => ({value, label: value}));
  };
  service._reference = () => ({getValue: () => 'true', getDisplayValue: () => 'Selected record'});
  service._metadataErrors = () => [];
  service._prepareStorage = () => {};
  context.GlideRecordSecure = function () {
    let next = true;
    this.addQuery = this.query = () => {};
    this.next = () => { const result = next; next = false; return result; };
    this.role = {name: 'cato_sync.receiver'};
  };
  return {service, context, properties, writes};
}
function config() {
  return {
    integration_id: '11111111-1111-1111-1111-111111111111', account_id: '9223372036854775807',
    instance_origin: 'https://customer.example', assignment_group: 'a'.repeat(32), capture_mode: 'group', title_prefix: '[SYNC-HUB]',
    gateway_url: 'https://gateway.example/graphql', gateway_credential_id: 'b'.repeat(32), receiver_user: 'c'.repeat(32), resolution_code: 'resolved',
    state_profile: JSON.stringify({NEW: '1', IN_PROGRESS: '2', ON_HOLD: '3', RESOLVED: '6', CLOSED: '7', AWAITING_CALLER: '1', AWAITING_VENDOR: '4', AWAITING_CHANGE: '5'}),
    priority_profile: JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5].map(priority => [priority, {impact: '2', urgency: '3'}])))
  };
}
test('fresh setup prefills the origin and retains the historical default routing', () => {
  const {service} = setup({'glide.servlet.uri': 'https://customer.example/'});
  const model = service.view();
  assert.equal(model.enabled, false);
  assert.equal(model.config.instance_origin, 'https://customer.example');
  assert.equal(model.config.capture_mode, 'group-and-title');
  assert.equal(model.config.title_prefix, '[SYNC-HUB]');
});
test('existing 0.3.3 configuration loads without rewriting settings or durable data', () => {
  const properties = Object.fromEntries(Object.entries(config()).map(([key, value]) => ['cato_sync.' + key, value]));
  properties['cato_sync.package_version'] = '0.3.3';
  const {service, writes} = setup(properties);
  assert.deepEqual(JSON.parse(JSON.stringify(service.view().config)), config());
  assert.equal(writes.length, 0);
});
test('invalid mappings and identity report multiple failures before any property write', () => {
  const {service, writes} = setup();
  const input = config(); input.state_profile = '{}'; input.priority_profile = '{}'; input.account_id = '9223372036854775808';
  const result = service.execute('save', input);
  assert.ok(result.errors.length > 15);
  assert.ok(result.errors.some(message => message.includes('64-bit')));
  assert.equal(writes.length, 0);
});
test('Zurich inherited scripting gate is allowed but explicit scripting and data roles are rejected', () => {
  function validate(extraRole, inherited) {
    const {service, context} = setup();
    context.GlideRecordSecure = function () {
      let index = -1;
      const rows = [{name: 'cato_sync.receiver', inherited: 'false'}, {name: extraRole, inherited}];
      this.addQuery = this.query = () => {};
      this.next = () => { index++; this.role = {name: rows[index]?.name}; return index < rows.length; };
      this.getValue = key => rows[index][key];
    };
    return service.execute('save', config()).errors;
  }
  assert.equal(validate('snc_required_script_writer_permission', 'true').length, 0);
  for (const [role, inherited] of [['snc_required_script_writer_permission', 'false'], ['itil', 'true'], ['admin', 'false']]) {
    assert.ok(validate(role, inherited).some(error => error === 'Remove receiver role: ' + role));
  }
});
test('save rejects enabled configuration and leaves failed writes paused', () => {
  const {service, properties, context} = setup({'cato_sync.enabled': 'true'});
  assert.match(service.execute('save', config()).errors[0], /Pause/);
  properties['cato_sync.enabled'] = 'false';
  const write = context.gs.setProperty;
  context.gs.setProperty = (key, value) => { if (key.endsWith('account_id')) throw Error('storage failure'); write(key, value); };
  assert.match(service.execute('save', config()).errors[0], /Save failed/);
  assert.equal(properties['cato_sync.enabled'], 'false');
});
test('enable revalidates saved settings and requires external confirmation', () => {
  const {service, properties} = setup();
  assert.equal(service.execute('save', config()).errors.length, 0);
  assert.equal(service.execute('validate').errors.length, 0);
  assert.match(service.execute('enable', {}, false).errors[0], /Confirm/);
  assert.equal(service.execute('enable', {}, true).enabled, true);
  assert.equal(service.execute('pause').enabled, false);
  properties['cato_sync.state_profile'] = '{}';
  assert.ok(service.execute('enable', {}, true).errors.length > 0);
  assert.equal(properties['cato_sync.enabled'], 'false');
});
test('server actions and setup view deny non-admin access without writes', () => {
  const {service, writes} = setup({}, false);
  for (const action of ['save', 'validate', 'enable', 'pause']) assert.throws(() => service.execute(action, config(), true), /Administrator/);
  assert.throws(() => service.view(), /Administrator/);
  assert.equal(writes.length, 0);
});
test('AJAX denies anonymous/non-admin requests before reading arguments', () => {
  let created = false;
  const context = vm.createContext({Class: {create: () => function () {}}, Object: {extendsObject: (base, object) => object}, AbstractAjaxProcessor: function () {}, gs: {hasRole: () => false}, CatoSyncSetup: function () { created = true; }});
  vm.runInContext(fs.readFileSync('servicenow/CatoSyncSetupAjax.js', 'utf8'), context);
  const ajax = new context.CatoSyncSetupAjax();
  assert.equal(ajax.isPublic(), false);
  assert.match(JSON.parse(ajax.execute()).errors[0], /Administrator/);
  assert.equal(created, false);
});
test('published setup exposes only credential references and runtime allowlist', () => {
  const installer = fs.readFileSync('build/install.js', 'utf8');
  assert.ok(installer.includes('cato_sync_setup'));
  assert.ok(!installer.includes('CATO_SYNC_VERIFICATION_FAILED'));
  assert.ok(!/dev\d{3,}|catorefarch|sandbox synchronization|synthetic_priority_five/.test(installer));
  const page = fs.readFileSync('servicenow/setup-page.xml', 'utf8');
  assert.ok(page.includes("gs.hasRole('admin')"));
  assert.ok(page.includes('table="api_key_credentials"'));
  assert.ok(!page.includes('type="password"'));
});
test('native Java string property values preserve enabled state', () => {
  const {service} = setup({'cato_sync.enabled': new String('true')});
  assert.equal(service.view().enabled, true);
  assert.match(service.execute('save', config()).errors[0], /Pause/);
});
test('native choice lookup respects incident overrides and filters inactive values', () => {
  const {context} = setup();
  const records = {
    incident: [{value: '1', label: 'Incident new'}, {value: '2', label: 'Inactive', inactive: 'true'}],
    task: [{value: '1', label: 'Task new'}, {value: '2', label: 'Task working'}, {value: '3', label: 'Inherited'}]
  };
  context.GlideRecordSecure = function () {
    let table, rows, index = -1;
    this.addQuery = (key, value) => { if (key === 'name') table = value; };
    this.orderBy = () => {};
    this.query = () => { rows = records[table]; };
    this.next = () => ++index < rows.length;
    this.getValue = key => rows[index][key] || '';
  };
  const result = new context.CatoSyncSetup()._choices('state');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{value: '1', label: 'Incident new'}, {value: '3', label: 'Inherited'}]);
});
test('metadata validation reports missing app, page/table ACLs, indexes and audit together', () => {
  const {context} = setup();
  context.GlideRecordSecure = function () {
    this.get = this.next = this.isValidField = () => false;
    this.addQuery = this.addNullQuery = this.query = () => {};
  };
  context.GlideIndexDescriptor = function () { this.setUnique = () => {}; this.hasIndex = () => false; };
  context.GlideStringUtil = {split: value => [value]};
  const errors = new context.CatoSyncSetup()._metadataErrors();
  for (const expected of ['Global application', 'setup page', 'Missing ACL', 'unique index', 'Incident auditing', 'Missing field'])
    assert.ok(errors.some(message => message.includes(expected)), expected);
});
test('storage preparation verifies four unique indexes and save remains paused on failure', () => {
  const {service, context, properties} = setup();
  const indexes = [];
  context.gs.ensureIndex = (table, column) => { indexes.push(table + '.' + column); return true; };
  context.GlideIndexDescriptor = function () { this.setUnique = () => {}; this.hasIndex = () => true; };
  context.GlideStringUtil = {split: value => [value]};
  const prepare = new context.CatoSyncSetup()._prepareStorage;
  prepare();
  assert.equal(indexes.length, 4);
  assert.ok(indexes.includes('u_cato_sync_inbox.u_stream_key'));
  service._prepareStorage = prepare;
  context.gs.ensureIndex = () => false;
  assert.match(service.execute('save', config()).errors[0], /Save failed/);
  assert.equal(properties['cato_sync.enabled'], 'false');
  assert.equal(properties['cato_sync.integration_id'], undefined);
});
