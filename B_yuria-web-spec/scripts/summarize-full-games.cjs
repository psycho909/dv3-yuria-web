const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {production}=require('./replay-offer-models.cjs');
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
function ci(a){const rng=production.mulberry32(20261010),d=Array.from({length:10000},()=>avg(Array.from({length:a.length},()=>a[Math.floor(rng()*a.length)]))).sort((a,b)=>a-b);return [d[249],d[9749]];}
function summarize(directory){
 const load=(world,goal,n,s)=>JSON.parse(fs.readFileSync(path.join(directory,`full-games-${world}-${goal}-2026-09-30-n${n}-s${s}.json`)));
 const baseline=[],sensitivity=[],goalComparisons=[];
 for(const world of ['production','candidate']){
  const a=load(world,'target2400',100,2048),b=load(world,'expected2400',100,2048),high=load(world,'target2400',40,8192);
  for(const r of [a,b,high]){
   assert.equal(r.kind,'synthetic-full-games');assert.equal(r.provenance.domainSHA256,a.provenance.domainSHA256);assert.equal(r.provenance.environmentSeed,a.provenance.environmentSeed);assert.equal(r.provenance.decisionSeed,a.provenance.decisionSeed);
   assert.ok(r.rows.every((x,i)=>x.game===i));assert.equal(r.rows.length,r.summary.gamesPerPolicy);
  }
  baseline.push({world,goal:a.goal,...a.summary,hitDifferenceNoObservedDiscordance:a.rows.every(r=>r.production.hit2400===r.candidate.hit2400)},{world,goal:b.goal,...b.summary,hitDifferenceNoObservedDiscordance:b.rows.every(r=>r.production.hit2400===r.candidate.hit2400)});
  const low=a.rows.slice(0,40),d=high.rows.map((r,i)=>(r.candidate.score-r.production.score)-(low[i].candidate.score-low[i].production.score));
  sensitivity.push({world,n:40,lowBudgetPairMeanGain:avg(low.map(r=>r.candidate.score-r.production.score)),highBudgetSummary:high.summary,changeOfPairGain:avg(d),changeOfPairGainCI95:ci(d),productionFinalScoreChanged:high.rows.filter((r,i)=>r.production.score!==low[i].production.score).length,candidateFinalScoreChanged:high.rows.filter((r,i)=>r.candidate.score!==low[i].candidate.score).length});
  for(const policy of ['production','candidate']){
   const ds=b.rows.map((r,i)=>r[policy].score-a.rows[i][policy].score),hs=b.rows.map((r,i)=>Number(r[policy].hit2400)-Number(a.rows[i][policy].hit2400));
   goalComparisons.push({world,policy,n:100,expectedMinusThresholdMean:avg(ds),meanCI95:ci(ds),expectedMinusThresholdHitRate:avg(hs),hitCI95:ci(hs),hitDifferenceNoObservedDiscordance:hs.every(x=>x===0)});
  }
 }
 return {baseline,sensitivity,goalComparisons,interpretation:'All outcomes are complete synthetic games; paired CIs use game seeds. High-budget sensitivity reuses first 40 seeds, not independent extra games. Bootstrap hit intervals [0,0] with no observed discordance are degenerate and do not prove identical true hit rates.'};
}
if(require.main===module){const [directory,output]=process.argv.slice(2);if(!output)throw Error('Usage: node scripts/summarize-full-games.cjs REPORTS_DIR OUTPUT');const result=summarize(directory);fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={summarize};
