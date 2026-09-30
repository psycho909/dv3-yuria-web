// Synthetic full-game benchmark. Production math is reused; no historical outcomes are spliced in.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {production,candidate}=require('./replay-offer-models.cjs');
const {sampleOffer}=require('./benchmark-offer-models.cjs');
const root=path.resolve(__dirname,'..');
const model={family:'card',early:[10,10,5],final:[5,10,20]};
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function seedFor(seed,game,turn,stream){return (Math.imul(seed^0x9e3779b9,0x85ebca6b)^Math.imul(game+1,0xc2b2ae35)^Math.imul(turn+1,0x27d4eb2f)^Math.imul(stream+1,0x165667b1))>>>0;}
function playGame({world,policy,objective,game,simulations,environmentSeed=20260930,decisionSeed=20261003,offerOverride,choiceOverride}){
 assert.ok(['production','candidate'].includes(world));assert.ok(['production','candidate'].includes(policy));
 const rules=production.RULES,engine=policy==='production'?production:candidate;
 let selected=[];const turns=[];let decisionMs=0;
 for(let turn=1;turn<=5;turn++){
  const offerRng=production.mulberry32(seedFor(environmentSeed,game,turn,0));
  const offers=offerOverride?offerOverride(selected,turn):world==='production'?production.generateOffer(offerRng,selected,turn,rules):sampleOffer(model,offerRng,selected,turn);
  assert.equal(offers.length,3);assert.equal(new Set(offers.map(c=>c.cardId)).size,3);
  assert.ok(offers.every(c=>!selected.some(p=>p.cardId===c.cardId)));
  const start=performance.now();
  const recommendation=choiceOverride?null:engine.recommend({turn,selected},offers,objective,simulations,seedFor(decisionSeed,game,turn,3),rules,2400);
  decisionMs+=performance.now()-start;
  const chosen=choiceOverride?choiceOverride(offers,selected,turn):recommendation.ranked[0].candidate;
  assert.ok(offers.some(c=>c.cardId===chosen.cardId&&c.color===chosen.color));
  selected=production.resolveSelection(production.mulberry32(seedFor(environmentSeed,game,turn,1)),selected,chosen,rules);
  turns.push({turn,offers,chosen,selected:selected.map(c=>({...c})),prediction:recommendation?.ranked[0]??null});
 }
 const redUniform=production.mulberry32(seedFor(environmentSeed,game,6,2))();
 const breakdown=production.calculateScore(selected,()=>redUniform,rules);
 return {score:breakdown.finalScore,hit2400:breakdown.finalScore>=2400,selected,redUniform,breakdown,turns,decisionMs};
}
function ci(values,seed){const rng=production.mulberry32(seed);const draws=Array.from({length:10000},()=>mean(Array.from({length:values.length},()=>values[Math.floor(rng()*values.length)]))).sort((a,b)=>a-b);return [draws[249],draws[9749]];}
function wilson(k,n){const z=1.95996398454,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [c-r,c+r];}
function summarize(rows){
 const policies={};for(const name of ['production','candidate']){
  const scores=rows.map(r=>r[name].score).sort((a,b)=>a-b),hits=scores.filter(s=>s>=2400).length;
  policies[name]={n:rows.length,mean:mean(scores),meanCI95:ci(scores,20261004),median:scores[Math.floor((scores.length-1)/2)],p10:scores[Math.floor((scores.length-1)*.1)],p90:scores[Math.floor((scores.length-1)*.9)],min:scores[0],max:scores.at(-1),hits2400:hits,hitRate2400:hits/rows.length,hitRateCI95:wilson(hits,rows.length),totalDecisionMs:rows.reduce((s,r)=>s+r[name].decisionMs,0)};
 }
 const ds=rows.map(r=>r.candidate.score-r.production.score),hs=rows.map(r=>Number(r.candidate.hit2400)-Number(r.production.hit2400));
 return {gamesPerPolicy:rows.length,policies,paired:{meanGain:mean(ds),meanGainCI95:ci(ds,20261005),hitRateGain:mean(hs),hitRateGainCI95:ci(hs,20261006),candidateWins:ds.filter(d=>d>0).length,productionWins:ds.filter(d=>d<0).length,ties:ds.filter(d=>d===0).length,differentTrajectories:rows.filter(r=>r.changedTurns>0).length}};
}
function main(){
 const [output,world,goal='target2400',nArg='100',sArg='2048']=process.argv.slice(2);
 if(!output)throw Error('Usage: node scripts/benchmark-full-games.cjs OUTPUT production|candidate target2400|expected2400 [pairs=100] [simulations=2048]');
 assert.ok(['target2400','expected2400'].includes(goal));const n=Number(nArg),simulations=Number(sArg);assert.ok(Number.isInteger(n)&&n>0&&Number.isInteger(simulations)&&simulations>0);
 const objective=goal==='target2400'?{kind:'threshold',target:2400}:{kind:'expected'};
 const rows=[],traces=[],start=performance.now();
 for(let game=0;game<n;game++){
  const a=playGame({world,policy:'production',objective,game,simulations}),b=playGame({world,policy:'candidate',objective,game,simulations});
  const changedTurns=a.turns.filter((t,i)=>t.chosen.cardId!==b.turns[i].chosen.cardId||t.chosen.color!==b.turns[i].chosen.color).length;
  rows.push({game,production:{score:a.score,hit2400:a.hit2400,decisionMs:a.decisionMs},candidate:{score:b.score,hit2400:b.hit2400,decisionMs:b.decisionMs},changedTurns});
  if(game<3||changedTurns>0&&traces.filter(t=>t.changedTurns>0).length<3)traces.push({game,changedTurns,production:a,candidate:b});
  if((game+1)%10===0)console.log(`${world}/${goal}/S${simulations}: ${game+1}/${n} pairs`);
 }
 const report={kind:'synthetic-full-games',world,goal,provenance:{sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),domainSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/domain.ts'))).digest('hex'),environmentSeed:20260930,decisionSeed:20261003,simulations,bootstrapSamples:10000,elapsedMs:performance.now()-start},rules:production.RULES,researchModel:model,summary:summarize(rows),limitations:['Synthetic games, not new real-game evidence.','Each policy starts empty and replans all five rounds; actual environment conditions on its own selected cards.','Streams are paired by game and turn; after choices diverge, offers differ legally because selected identities differ.','Both models use existing deterministic score rules, including unresolved red and World/Moon assumptions.','Only the recommendation offer model differs within each objective; rollout continuation still uses production immediate policy.','Finite recommendation budgets and two assumed worlds do not establish real-world uplift.'],rows,traces};
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({world,goal,simulations,...report.summary},null,2));
}
if(require.main===module)main();
module.exports={playGame,seedFor,summarize};
