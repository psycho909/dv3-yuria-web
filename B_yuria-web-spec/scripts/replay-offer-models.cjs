// Isolated research build: change only the rollout's offer call in memory, never edit src/domain.ts.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/domain.ts'),'utf8');
const hook='const offers = generateOffer(streams.offer, selected, turn, rules);';
assert.equal(source.split(hook).length-1,1,'research hook must match exactly one rollout offer call');
const candidateModel={family:'card',early:[10,10,5],final:[5,10,20]};
function load(fixed){
  const transformed=fixed?source.replace(hook,'const offers = researchOffers(streams.offer, selected, turn, rules);'):source;
  const extra=fixed?`\nconst researchSampler = require('./scripts/benchmark-offer-models.cjs').sampleOffer;\nfunction researchOffers(rng: Rng, selected: SelectedCard[], turn: number, rules: Rules): OfferedCard[] { if (rules.futureColorModel !== 'oneEach') throw new Error('Research requires oneEach'); return researchSampler(${JSON.stringify(candidateModel)}, rng, selected, turn); }`:'';
  const bundle=buildSync({stdin:{contents:transformed+extra,resolveDir:path.join(root,'src'),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['./scripts/benchmark-offer-models.cjs']});
  const loaded=new Module(path.join(root,'research-replay.cjs'),module);loaded.paths=module.paths;
  loaded._compile(bundle.outputFiles[0].text,path.join(root,'research-replay.cjs'));return loaded.exports;
}
const production=load(false),candidate=load(true);
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function ci(values,seed){if(!values.length)return null;const rng=production.mulberry32(seed),draws=Array.from({length:10000},()=>avg(Array.from({length:values.length},()=>values[Math.floor(rng()*values.length)]))).sort((a,b)=>a-b);return [draws[249],draws[9749]];}
function replayState(g,index){return {turn:index+1,selected:g.rounds.slice(0,index).map(r=>({...r.chosen,activated:r.activated,towerProc:r.towerProc??undefined}))};}
function scenarioSettings(round,scenario){
  if(scenario==='historical')return {objective:round.objective,target:round.target};
  if(scenario==='target1500')return {objective:{kind:'threshold',target:1500},target:1500};
  if(scenario==='target2400')return {objective:{kind:'threshold',target:2400},target:2400};
  if(scenario==='expected')return {objective:{kind:'expected'},target:1500};
  if(scenario==='expected2400')return {objective:{kind:'expected'},target:2400};
  throw Error('Unknown scenario: '+scenario);
}
function main(){
  const [input,output,simArg,scenario='historical',seedArg]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/replay-offer-models.cjs INPUT OUTPUT [simulations=2048] [historical|target1500|target2400|expected|expected2400] [seed=20260930]');
  const simulations=Number(simArg??2048);assert.ok(Number.isInteger(simulations)&&simulations>0);
  const seed=Number(seedArg??20260930),evaluationSeed=seed+71;assert.ok(Number.isInteger(seed));scenarioSettings({},scenario);
  const bytes=fs.readFileSync(input),games=JSON.parse(bytes).games;
  const auditModule=new Module(path.join(root,'schema-check.cjs'),module);
  const schema=buildSync({stdin:{contents:'export * from "./src/real-game-record";',resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false});
  auditModule._compile(schema.outputFiles[0].text,path.join(root,'schema-check.cjs'));assert.ok(games.every(auditModule.exports.isValidGameRecord));
  const sorted=games.map((g,i)=>({g,ordinal:i+1})).sort((a,b)=>a.g.createdAt.localeCompare(b.g.createdAt)||a.ordinal-b.ordinal);
  const test=sorted.slice(Math.floor(sorted.length*.8));
  assert.ok(test.every(({g})=>g.rulesSnapshot.futureColorModel==='oneEach'));
  const rows=[];
  for(const {g,ordinal}of test){
    for(let index=0;index<5;index++){
      const r=g.rounds[index],state=replayState(g,index);assert.ok(r.offers?.length===3);
      const options=r.offers.map(({cardId,color})=>({cardId,color}));
      const settings=scenarioSettings(r,scenario);
      const args=[state,options,settings.objective,simulations,seed,g.rulesSnapshot,settings.target];
      const old=production.recommend(...args),next=candidate.recommend(...args);
      const a=old.ranked[0].candidate,b=next.ranked[0].candidate,changed=a.cardId!==b.cardId||a.color!==b.color;
      const row={ordinal,turn:index+1,target:settings.target,objective:settings.objective,actualFinalScore:g.actualFinalScore,production:old,candidate:next,changed,evaluation:{}};
      if(changed){
        // Freeze both decisions, then compare on an independent rollout seed in BOTH assumed worlds.
        for(const [name,engine]of [['productionWorld',production],['candidateWorld',candidate]]){
          const result=engine.recommend(state,[a,b],settings.objective,simulations,evaluationSeed,g.rulesSnapshot,settings.target);
          const ma=result.ranked.find(m=>m.candidate.cardId===a.cardId),mb=result.ranked.find(m=>m.candidate.cardId===b.cardId);
          row.evaluation[name]={old:ma,next:mb,meanGain:mb.meanScore-ma.meanScore,hitGain:mb.thresholdProbability-ma.thresholdProbability,independentSeedPrefersCandidate:result.ranked[0].candidate.cardId===b.cardId};
        }
      }
      rows.push(row);
    }
    console.log(`replayed ${rows.length/5}/${test.length} games; changed ${rows.filter(r=>r.changed).length} decisions`);
  }
  const byTurn=[1,2,3,4,5].map(turn=>({turn,n:rows.filter(r=>r.turn===turn).length,changed:rows.filter(r=>r.turn===turn&&r.changed).length,
    meanPredictionShift:avg(rows.filter(r=>r.turn===turn).map(r=>{const choice=r.production.ranked[0].candidate;return r.candidate.ranked.find(m=>m.candidate.cardId===choice.cardId).meanScore-r.production.ranked[0].meanScore;}))}));
  const worlds={};for(const name of ['productionWorld','candidateWorld']){
    // Average the five per-state gains within each game, then bootstrap whole games. Identical choices have zero gain.
    const gs=test.map(({ordinal})=>avg(rows.filter(r=>r.ordinal===ordinal).map(r=>r.evaluation[name]?.meanGain??0)));
    const hs=test.map(({ordinal})=>avg(rows.filter(r=>r.ordinal===ordinal).map(r=>r.evaluation[name]?.hitGain??0)));
    const changed=rows.filter(r=>r.changed);
    worlds[name]={meanGainPerDecision:avg(gs),meanGainCI95:ci(gs,seed),hitProbabilityGainPerDecision:avg(hs),hitGainCI95:ci(hs,seed+1),changedDecisionMeanGain:avg(changed.map(r=>r.evaluation[name].meanGain)),changedDecisionHitGain:avg(changed.map(r=>r.evaluation[name].hitGain)),independentSeedPrefersCandidate:changed.filter(r=>r.evaluation[name].independentSeedPrefersCandidate).length};
  }
  const report={scenario,provenance:{inputSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),domainSHA256:crypto.createHash('sha256').update(source).digest('hex'),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),seed,evaluationSeed,simulations,bootstrapSamples:10000},researchModel:candidateModel,summary:{games:test.length,decisions:rows.length,changed:rows.filter(r=>r.changed).length,byTurn,worlds},limitations:['Replay uses actual historical prefixes, not complete alternative games.','Gains average state decisions; they are not additional points per completed game and must not be summed.','Rollout continuation uses the unchanged production immediate policy and exact final step, not replanning each future turn.','Only the candidate assumed world has evidence of better offer fit; neither world is confirmed ground truth.','The chronological test was inspected in prior audits; results are exploratory.','Actual scores are annotations only; there are no realized outcomes for unchosen cards.'],rows};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary,null,2));
}
if(require.main===module)main();
module.exports={production,candidate,replayState,scenarioSettings,load};
