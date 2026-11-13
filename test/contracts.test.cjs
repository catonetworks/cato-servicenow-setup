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
test('LINK recovery persists ticket metadata after incident update already committed',()=>{
  const state={u_next_sequence:1}; let updates=0;
  const c=runtime(); const hub=new c.CatoSyncHub();
  hub.ledger=()=>({getValue:k=>state[k],setValue:(k,v)=>state[k]=v,update:()=>++updates});
  const body={...base,kind:'LINK',ticketId:'123'};
  const incident={getValue:k=>k==='u_cato_sync_last_delivery'?body.deliveryId:null,update:()=>{throw Error('Must not repeat incident write');}};
  assert.equal(hub.apply(body,incident),true); assert.equal(state.u_ticket_id,'123'); assert.equal(state.u_next_sequence,2); assert.equal(updates,1);
});
test('field conflicts never apply or advance the stream',()=>{
  const c=runtime(); const hub=new c.CatoSyncHub();
  hub.ledger=()=>({getValue:()=>1,update:()=>{throw Error('Must not advance');}}); hub.state=()=> 'NEW';
  const incident={getValue:k=>({priority:'3',short_description:'human'}[k] || ''),setValue:()=>{throw Error('Must not mutate');}};
  assert.throws(()=>hub.apply(base,incident),/FIELD_CONFLICT/);
});
test('every source and generated installer parses',()=>{
  for(const dir of ['servicenow','build']) for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.js'))) new vm.Script(fs.readFileSync(dir+'/'+name,'utf8'),{filename:name});
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
function evidenceRuntime(tables) {
  return runtime({GlideRecord:function(table){
    let data, conditions=[], results=[];
    this.get=(key,value)=>{data=(tables[table]||[]).find(row=>value===undefined?row.sys_id===key:row[key]===value);return Boolean(data);};
    this.getValue=key=>data?.[key];
    this.addQuery=(key,value)=>conditions.push([key,value]); this.setLimit=()=>{};
    this.query=()=>{results=(tables[table]||[]).filter(row=>conditions.every(([key,value])=>row[key]===value));};
    this.next=()=>{data=results.shift();return Boolean(data);};
  }});
}
const evidenceRow=(event,kind)=>({getValue:key=>({u_key:event.eventId,u_record:event.source.recordId,u_proof_kind:kind}[key])});
test('incident commit evidence survives later updates but rejects orphan and legacy outbox rows',()=>{
  const id='a'.repeat(32), event={eventId:'incident:earlier',kind:'PATCH',source:{recordId:id}};
  const tables={incident:[{sys_id:id,u_cato_sync_source_event:'incident:latest'}],sys_audit:[]};
  const hub=new (evidenceRuntime(tables).CatoSyncHub)();
  assert.equal(hub.sourceCommitted(evidenceRow(event,'INCIDENT_OPERATION'),event),false);
  tables.sys_audit.push({tablename:'incident',documentkey:id,fieldname:'u_cato_sync_source_event',newvalue:event.eventId});
  assert.equal(hub.sourceCommitted(evidenceRow(event,'INCIDENT_OPERATION'),event),true);
  assert.equal(hub.sourceCommitted(evidenceRow(event,''),event),false);
  tables.incident=[];
  assert.equal(hub.sourceCommitted(evidenceRow(event,'INCIDENT_OPERATION'),event),false);
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
test('journal application uses supported API and requires exact committed effect before advancing',()=>{
  let written, updates=0, next=1, journalCalls=0;
  const body={...base,kind:'JOURNAL',journal:{body:'same',visibility:'PUBLIC'}};
  const c=runtime({GlideRecord:function(){this.get=()=>Boolean(written);this.getValue=k=>written?.[k];},
    gs:{getSession:()=>({putClientData:()=>{}})}});
  const hub=new c.CatoSyncHub();hub.ledger=()=>({getValue:()=>next,setValue:(k,v)=>{next=v;},update:()=>1});
  let marker='';const incident={getValue:()=>marker,setValue:(k,v)=>{marker=v;},
    comments:{setJournalEntry:()=>{journalCalls++;}},update:()=>{updates++;written={element_id:body.recordId,element:'comments',value:body.journal.body};return 1;}};
  assert.equal(hub.apply(body,incident),true);assert.equal(next,2);assert.equal(journalCalls,1);
  next=1;assert.equal(hub.apply(body,incident),true);assert.equal(updates,1);
  next=1;written=undefined;assert.throws(()=>hub.apply(body,incident),/LOCAL_EFFECT_MISMATCH/);
  assert.equal(next,1);assert.equal(updates,1);
});
