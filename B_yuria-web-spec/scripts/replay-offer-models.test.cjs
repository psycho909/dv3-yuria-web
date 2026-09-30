const test=require('node:test'),assert=require('node:assert/strict');
const {production,candidate,replayState,scenarioSettings,load}=require('./replay-offer-models.cjs');
const rules=production.RULES;
const offers=[{cardId:'magician',color:'blue'},{cardId:'strength',color:'purple'},{cardId:'devil',color:'red'}];
test('research baseline compilation reproduces an independently compiled unchanged baseline',()=>{
 const args=[{turn:1,selected:[]},offers,{kind:'threshold',target:1500},64,99,rules];
 assert.deepEqual(production.recommend(...args),load(false).recommend(...args));
});
test('fifth-turn scoring/ranking is identical: future offer model is irrelevant',()=>{
 const selected=[{cardId:'star',color:'blue',activated:true},{cardId:'moon',color:'red',activated:true},{cardId:'world',color:'purple',activated:false},{cardId:'tower',color:'blue',activated:true,towerProc:false}];
 for(const objective of [{kind:'threshold',target:1500},{kind:'expected'},{kind:'stability'}])assert.deepEqual(production.recommend({turn:5,selected},offers,objective,64,99,rules),candidate.recommend({turn:5,selected},offers,objective,64,99,rules));
});
test('replay prefix excludes future activations and delayed Star removal',()=>{
 const g={rounds:[{chosen:{cardId:'star',color:'blue'},activated:true,starRemovedCardId:'magician'},{chosen:offers[0],activated:false},{chosen:offers[1],activated:true}]};
 const state=replayState(g,1);assert.equal(state.selected.length,1);assert.equal(state.selected[0].removed,undefined);assert.equal(state.turn,2);
});
test('research changes early predictions and is reproducible',()=>{
 const args=[{turn:1,selected:[]},offers,{kind:'expected'},128,100,rules];
 const result=candidate.recommend(...args);assert.deepEqual(result,candidate.recommend(...args));assert.notDeepEqual(result,production.recommend(...args));
});
test('scenario overrides objective and target without mutating the historical record',()=>{
 const round={objective:{kind:'threshold',target:3000},target:3000},before=JSON.stringify(round);
 assert.deepEqual(scenarioSettings(round,'target1500'),{objective:{kind:'threshold',target:1500},target:1500});
 assert.deepEqual(scenarioSettings(round,'expected'),{objective:{kind:'expected'},target:1500});
 assert.deepEqual(scenarioSettings(round,'target2400'),{objective:{kind:'threshold',target:2400},target:2400});
 assert.deepEqual(scenarioSettings(round,'expected2400'),{objective:{kind:'expected'},target:2400});
 assert.deepEqual(scenarioSettings(round,'historical'),round);assert.equal(JSON.stringify(round),before);
 assert.throws(()=>scenarioSettings(round,'invalid'));
});
