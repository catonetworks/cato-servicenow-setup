const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function runtime(extra = {}) {
  const context = vm.createContext({Class: {create: () => function() {}}, ...extra});
  for (const file of ['CatoSyncRules.js', 'CatoSyncHub.js']) vm.runInContext(fs.readFileSync('servicenow/' + file, 'utf8'), context);
  return context;
}
const base = {schemaVersion:1, integrationId:'integration', deliveryId:'11111111-1111-1111-1111-111111111111', operationId:'22222222-2222-2222-2222-222222222222', recordId:'a'.repeat(32), sequence:1, kind:'PATCH', fields:{priority:4}, expected:{priority:5}};
test('receiver validates identity, typed fields, scope, ordering, and forbidden visibility', () => {
  const r=runtime().CatoSyncRules;
  assert.equal(r.receiver(base,'integration'),base);
  for (const changed of [{integrationId:'forged'}, {sequence:0}, {deliveryId:'-'.repeat(36)}, {fields:{priority:'4'}}, {expected:{priority:null}}, {fields:{state:'CLOSED'}}, {extra:'forged'}, {kind:'JOURNAL',fields:undefined,expected:undefined,journal:{id:'a',body:'private',visibility:'PRIVATE'}}])
    assert.throws(()=>r.receiver({...base,...changed},'integration'));
  assert.equal(r.transition(1,1),'READY'); assert.equal(r.transition(2,1),'WAIT'); assert.equal(r.transition(1,2),'DUPLICATE');
});
test('canonical deduplication distinguishes exact content but ignores property order',()=>{
  const r=runtime().CatoSyncRules;
  assert.equal(r.canonical({a:1,b:2}),r.canonical({b:2,a:1}));
  assert.notEqual(r.canonical({id:'a',body:'same'}),r.canonical({id:'b',body:'same'}));
});
test('capture is scoped to the assignment group with an optional title filter', () => {
  const properties = { 'cato_sync.assignment_group': 'approved-group' };
  const hub = new (runtime({gs: {getProperty: (name, fallback) => properties[name] ?? fallback}}).CatoSyncHub)();
  const incident = (group, title) => ({getValue: field => ({assignment_group: group, short_description: title})[field]});
  assert.equal(hub.eligible(incident('approved-group', '[SYNC-HUB] synthetic')), true);
  assert.equal(hub.eligible(incident('approved-group', 'service failure')), false);
  properties['cato_sync.capture_mode'] = 'group';
  assert.equal(hub.eligible(incident('approved-group', 'service failure')), true);
  assert.equal(hub.eligible(incident('unrelated-group', '[SYNC-HUB] synthetic')), false);
  properties['cato_sync.capture_mode'] = 'group-and-title';
  properties['cato_sync.title_prefix'] = '[CHECK]';
  assert.equal(hub.eligible(incident('approved-group', '[CHECK] synthetic')), true);
  assert.equal(hub.eligible(incident('approved-group', '[SYNC-HUB] synthetic')), false);
  properties['cato_sync.capture_mode'] = 'unknown';
  assert.equal(hub.eligible(incident('approved-group', '[CHECK] synthetic')), false);
});
test('LINK advances atomically and replay leaves the incident untouched', () => {
  const state = {u_key: base.recordId, u_next_sequence: 1};
  const hub = new (evidenceRuntime({u_cato_sync_state: [state]}).CatoSyncHub)();
  const body = {...base, kind: 'LINK', ticketId: '123'};
  const incident = {update: () => assert.fail('LINK must not write the incident')};
  assert.equal(hub.apply(body, incident), true);
  assert.equal(hub.apply(body, incident), true);
  assert.equal(state.u_ticket_id, '123');
  assert.equal(state.u_next_sequence, 2);
});
test('field conflicts never apply or advance the stream', () => {
  const state = {u_key: base.recordId, u_next_sequence: 1};
  const hub = new (evidenceRuntime({u_cato_sync_state: [state]}).CatoSyncHub)();
  hub.state = () => 'NEW';
  const incident = {getValue: field => field === 'priority' ? '3' : '', setValue: () => assert.fail('Must not mutate')};
  const row = {getUniqueValue: () => 'delivery', getValue: () => null};
  assert.throws(() => hub.apply(base, incident, row), /FIELD_CONFLICT/);
  assert.equal(state.u_next_sequence, 1);
});
test('every source and generated installer parses',()=>{
  for(const dir of ['servicenow','build']) for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.js'))) new vm.Script(fs.readFileSync(dir+'/'+name,'utf8'),{filename:name});
});
test('publisher bootstrap checks private tables with ordinary admin before changing metadata', () => {
  const appId = 'b'.repeat(32);
  const tables = {
    sys_app: [{sys_id: appId, name: 'Cato Sync Hub', scope: 'global'}],
    sys_db_object: [{name: 'u_cato_sync_state', sys_package: appId, ws_access: '1'}]
  };
  const rolesChecked = [];
  const context = evidenceRuntime(tables, {gs: {hasRole: role => {
    rolesChecked.push(role);
    return role === 'admin';
  }}});
  vm.runInContext('GlideRecord.prototype.isValidField = function () { return false; };', context);
  assert.throws(() => vm.runInContext(fs.readFileSync('build/install.js', 'utf8'), context), /web services disabled/);
  assert.deepEqual(rolesChecked, ['admin']);
  assert.equal(tables.sys_db_object[0].ws_access, '1');
});
test('before rules abort source writes when durable capture fails',()=>{
  for (const file of ['incident-rule.js','journal-rule.js']) {
    let aborted=false;
    const current={getUniqueValue:()=> 'a'.repeat(32),setAbortAction:value=>{aborted=value;}};
    const context=vm.createContext({current,previous:{},gs:{error:()=>{},addErrorMessage:()=>{}},
      CatoSyncHub:function(){this.captureIncident=this.captureJournal=()=>{throw Error('outbox unavailable');};}});
    vm.runInContext(fs.readFileSync('servicenow/'+file,'utf8'),context);
    assert.equal(aborted,true);
  }
});
test('incident rules consume the exact receipt once without a display scratchpad', () => {
  const current = {getUniqueValue: () => 'a'.repeat(32)};
  const other = {getUniqueValue: () => 'b'.repeat(32)};
  const previous = {};
  const confirmed = [];
  const context = vm.createContext({current, previous, CatoSyncHub: function() {
    this.captureIncident = (record, prior) => {
      assert.equal(record, current);
      assert.equal(prior, previous);
      return 'attempt';
    };
    this.confirmIncident = (record, attempt) => {
      assert.equal(record, current);
      confirmed.push(attempt);
    };
  }});
  const runRule = file => vm.runInContext(fs.readFileSync('servicenow/' + file, 'utf8'), context);
  runRule('incident-rule.js');
  context.current = other;
  runRule('incident-confirm-rule.js');
  context.current = current;
  runRule('incident-confirm-rule.js');
  runRule('incident-confirm-rule.js');
  assert.deepEqual(confirmed, ['attempt']);
});
function evidenceRuntime(tables, extra = {}) {
  return runtime({...extra, GlideRecord: function(table) {
    let data;
    let results;
    const conditions = [];
    const values = {};
    const rows = tables[table] || [];
    this.get = (key, value) => {
      data = rows.find(row => value === undefined ? row.sys_id === key : row[key] === value);
      return Boolean(data);
    };
    this.getUniqueValue = () => data.sys_id;
    this.getValue = key => data?.[key];
    this.setValue = (key, value) => { values[key] = value; };
    this.addQuery = (key, value) => conditions.push(row => row[key] === value);
    this.addNullQuery = key => conditions.push(row => !row[key]);
    const matching = () => rows.filter(row => conditions.every(condition => condition(row)));
    this.setLimit = () => {};
    this.query = () => { results = matching(); };
    this.next = () => { data = results.shift(); return Boolean(data); };
    this.update = () => { Object.assign(data, values); return data.sys_id; };
    this.updateMultiple = () => matching().forEach(row => Object.assign(row, values));
  }});
}
const evidenceRow = (event, kind, confirmed) => ({getValue: key => ({
  u_key: event.eventId, u_record: event.source.recordId, u_proof_kind: kind, u_confirmed: confirmed
}[key])});
test('source proof requires the after-rule receipt for the exact outbox attempt', () => {
  const id = base.recordId;
  const event = {eventId: 'incident:earlier', kind: 'PATCH', source: {recordId: id}, fields: {title: 'earlier'}};
  const attempt = {sys_id: 'attempt', u_key: event.eventId, u_record: id, u_proof_kind: 'INCIDENT_RECEIPT', u_payload: JSON.stringify(event)};
  const context = evidenceRuntime({u_cato_sync_outbox: [attempt]});
  const hub = new context.CatoSyncHub();
  hub.eligible = () => true;
  const incident = {getUniqueValue: () => id, getValue: () => 'earlier', isActionAborted: () => true};
  hub.confirmIncident(incident, attempt.sys_id);
  assert.equal(attempt.u_confirmed, undefined);
  incident.isActionAborted = () => false;
  hub.confirmIncident(incident, attempt.sys_id);
  assert.equal(hub.sourceCommitted(evidenceRow(event, 'INCIDENT_RECEIPT', attempt.u_confirmed), event), true);
  assert.equal(hub.sourceCommitted(evidenceRow(event, 'INCIDENT_RECEIPT', false), event), false);
  assert.equal(hub.sourceCommitted(evidenceRow(event, 'INCIDENT_OPERATION', true), event), false);
});
test('journal proof requires exact committed identity and visibility, never matching text alone',()=>{
  const event={eventId:'journal:one',kind:'JOURNAL',source:{recordId:'a'.repeat(32)},journal:{id:'one',body:'same',visibility:'PUBLIC'}};
  const tables={sys_journal_field:[{sys_id:'two',element_id:event.source.recordId,element:'comments',value:'same'}]};
  const hub=new (evidenceRuntime(tables).CatoSyncHub)();
  assert.equal(hub.sourceCommitted(evidenceRow(event,'JOURNAL_ROW'),event),false);
  tables.sys_journal_field[0].sys_id='one';
  assert.equal(hub.sourceCommitted(evidenceRow(event,'JOURNAL_ROW'),event),true);
  tables.sys_journal_field[0].element='work_notes';
  assert.equal(hub.sourceCommitted(evidenceRow(event,'JOURNAL_ROW'),event),false);
});
test('unproven source capture never constructs an external request',()=>{
  let first=true, reason;
  const row={getUniqueValue:()=> 'outbox',getValue:()=>JSON.stringify({eventId:'orphan'})};
  const context=runtime({GlideRecord:function(){this.addQuery=this.orderBy=this.setLimit=this.query=()=>{};
    this.next=()=>{const result=first;first=false;return result;};this.getUniqueValue=row.getUniqueValue;},
    sn_ws:{RESTMessageV2:function(){throw Error('Must not send uncommitted source');}}});
  const hub=new context.CatoSyncHub();hub.enabled=()=>true;hub.recoverClaims=()=>{};hub.claim=()=>row;
  hub.sourceCommitted=()=>false;hub.retry=(work,code)=>{reason=code;};
  hub.dispatch();assert.equal(reason,'SOURCE_COMMIT_NOT_PROVEN');
});
test('journal retry verifies the exact persisted ID and never repeats an uncertain append', () => {
  const body = {...base, kind: 'JOURNAL', journal: {body: 'same'}};
  const claim = 'b'.repeat(32);
  const delivery = {sys_id: 'c'.repeat(32), u_claim: claim, u_state: 'PROCESSING', u_record: body.recordId, u_payload: JSON.stringify(body)};
  const state = {u_key: body.recordId, u_next_sequence: 1};
  const tables = {u_cato_sync_inbox: [delivery], u_cato_sync_state: [state], sys_journal_field: []};
  const sessionData = new Map();
  const session = {putClientData: (key, value) => sessionData.set(key, value), getClientData: key => sessionData.get(key), clearClientData: key => sessionData.delete(key)};
  const context = evidenceRuntime(tables, {gs: {getSession: () => session, getUserName: () => 'system'}});
  const hub = new context.CatoSyncHub();
  const row = {getUniqueValue: () => delivery.sys_id, getValue: key => delivery[key]};
  let appends = 0;
  const journalId = 'd'.repeat(32);
  const journal = {sys_id: journalId, element_id: body.recordId, element: 'comments', value: 'same'};
  const incident = {
    comments: {setJournalEntry: () => appends++},
    update: () => {
      hub.recordJournalEffect(hub.activeEffect(body.recordId).row, journalId);
      throw Error('Simulated loss of worker after the journal was reserved');
    }
  };
  assert.throws(() => hub.apply(body, incident, row), /Simulated loss/);
  assert.equal(delivery.u_journal_id, journalId);
  assert.equal(sessionData.size, 0);
  assert.equal(state.u_next_sequence, 1);
  delivery.u_claim = 'e'.repeat(32);
  tables.sys_journal_field.push({...journal, sys_id: 'f'.repeat(32)});
  assert.throws(() => hub.apply(body, incident, row), /LOCAL_EFFECT_UNCERTAIN/);
  tables.sys_journal_field.push(journal);
  assert.equal(hub.apply(body, incident, row), true);
  assert.equal(appends, 1);
  assert.equal(state.u_next_sequence, 2);
});
test('stale worker cannot write an untracked journal or replace its saved journal ID', () => {
  const claim = 'b'.repeat(32);
  const delivery = {sys_id: 'c'.repeat(32), u_claim: 'd'.repeat(32), u_state: 'PROCESSING', u_record: base.recordId, u_effect_claim: claim, u_journal_id: 'e'.repeat(32)};
  const context = evidenceRuntime({u_cato_sync_inbox: [delivery]}, {gs: {getSession: () => ({getClientData: () => delivery.sys_id + ':' + claim})}});
  const hub = new context.CatoSyncHub();
  hub.enabled = () => true;
  const journal = {isActionAborted: () => false, getValue: key => ({element: 'comments', element_id: base.recordId}[key])};
  assert.throws(() => hub.captureJournal(journal), /LOCAL_EFFECT_UNCERTAIN/);
  const staleRow = {getUniqueValue: () => delivery.sys_id, getValue: () => claim};
  assert.throws(() => hub.recordJournalEffect(staleRow, 'f'.repeat(32)), /JOURNAL_EVIDENCE_WRITE_FAILED/);
  assert.equal(delivery.u_journal_id, 'e'.repeat(32));
});
test('patch recovery requires the exact operation reason and all requested audit effects', () => {
  const body = {...base, fields: {priority: 4, title: 'new'}, expected: {priority: 5, title: 'old'}};
  const audits = [];
  const hub = new (evidenceRuntime({sys_audit: audits}).CatoSyncHub)();
  const audit = {tablename: 'incident', documentkey: base.recordId, reason: hub.effectReason(body), user: 'system'};
  audits.push({...audit, fieldname: 'priority', newvalue: '4'});
  audits.push({...audit, fieldname: 'short_description', newvalue: 'new', reason: 'other update'});
  audits.push({...audit, fieldname: 'short_description', newvalue: 'new', user: 'other-user'});
  assert.equal(hub.committedPatch(body, 'system'), false);
  audits.push({...audit, fieldname: 'short_description', newvalue: 'new'});
  assert.equal(hub.committedPatch(body, 'system'), true);
});
test('gateway authentication reads only a configured active encrypted credential',()=>{
  let active='1', exists=true, calls=0, configured='a'.repeat(32);
  const context=runtime({gs:{getProperty:()=>configured},
    GlideRecord:function(table){assert.equal(table,'api_key_credentials');this.get=()=>exists;this.getValue=()=>active;},
    sn_cc:{StandardCredentialsProvider:function(){this.getCredentialByID=id=>{calls++;assert.equal(id,'a'.repeat(32));return {getAttribute:name=>{assert.equal(name,'api_key');return 'inert-test-key';}};};}}});
  const hub=new context.CatoSyncHub();assert.equal(hub.gatewayKey(),'inert-test-key');assert.equal(calls,1);
  active='0';assert.throws(()=>hub.gatewayKey(),/DISABLED/);assert.equal(calls,1);
  active='1';exists=false;assert.throws(()=>hub.gatewayKey(),/DISABLED/);assert.equal(calls,1);
  configured='';assert.throws(()=>hub.gatewayKey(),/MISSING/);assert.equal(calls,1);
});
test('capture dispatch translates GraphQL enum without rewriting durable source and requires payload evidence',()=>{
  for (const accepted of [true,false]) {
    let first=true, sent, finished=false, retry;
    const original=JSON.stringify({eventId:'captured-event',kind:'CREATE',source:{table:'incident',recordId:'a'.repeat(32)}});
    const row={getUniqueValue:()=> 'outbox',getValue:()=>original};
    const context=runtime({GlideRecord:function(){this.addQuery=this.orderBy=this.setLimit=this.query=()=>{};
      this.next=()=>{const value=first;first=false;return value;};this.getUniqueValue=row.getUniqueValue;},
      sn_ws:{RESTMessageV2:function(){
        this.setEndpoint=this.setHttpMethod=this.setHttpTimeout=this.setRequestHeader=()=>{};
        this.setRequestBody=body=>{sent=JSON.parse(body);};
        this.execute=()=>({getStatusCode:()=>200,getBody:()=>JSON.stringify({data:{syncHub:{ingestEvent:accepted
          ?{event:{id:'durable-id',result:'ACCEPTED',state:'PENDING'}}:{result:'ACCEPTED'}}}})});
      }}});
    const hub=new context.CatoSyncHub();hub.enabled=()=>true;hub.recoverClaims=()=>{};hub.claim=()=>row;
    hub.sourceCommitted=(work,event)=>{assert.equal(event.source.table,'incident');return true;};
    hub.property=name=>name==='gateway_url'?'https://fixture.example/graphql':'test';hub.gatewayKey=()=> 'inert-fixture-key';
    hub.finish=()=>{finished=true;};hub.retry=(work,reason)=>{retry=reason;};
    hub.dispatch();
    assert.equal(sent.variables.event.source.table,'INCIDENT');
    assert.equal(JSON.parse(row.getValue()).source.table,'incident');
    assert.equal(finished,accepted);
    if(!accepted)assert.equal(retry,'HUB_NOT_ACCEPTED');
  }
});
