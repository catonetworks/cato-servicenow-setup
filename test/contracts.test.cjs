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
