// Summarize fixed-scenario research outputs; final-turn goal trade-offs use identical exact distributions.
const fs=require('node:fs'),assert=require('node:assert/strict');
function summarize(primary,secondary,expected){
 assert.equal(primary.scenario,'target2400');assert.equal(secondary.scenario,'target1500');assert.equal(expected.scenario,'expected2400');
 for(const r of [secondary,expected]){
  assert.equal(r.provenance.inputSHA256,primary.provenance.inputSHA256);
  assert.equal(r.provenance.domainSHA256,primary.provenance.domainSHA256);
  assert.equal(r.provenance.seed,primary.provenance.seed);
  assert.equal(r.provenance.simulations,primary.provenance.simulations);
  assert.deepEqual(r.rows.map(x=>[x.ordinal,x.turn]),primary.rows.map(x=>[x.ordinal,x.turn]));
 }
 const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
 const goalComparisons={};
 for(const engine of ['production','candidate']){
  const changed=primary.rows.filter((row,i)=>row[engine].ranked[0].candidate.cardId!==expected.rows[i][engine].ranked[0].candidate.cardId);
  const final=primary.rows.flatMap((row,i)=>{
   if(row.turn!==5)return [];
   const threshold=row[engine].ranked[0],mean=expected.rows[i][engine].ranked[0];
   assert.ok(mean.meanScore+1e-8>=threshold.meanScore,'expected goal must maximize the exact final mean');
   assert.ok(threshold.thresholdProbability+1e-8>=mean.thresholdProbability,'threshold goal must maximize exact final target rate');
   return [{ordinal:row.ordinal,thresholdChoice:threshold.candidate,expectedChoice:mean.candidate,meanGain:mean.meanScore-threshold.meanScore,hitGain:mean.thresholdProbability-threshold.thresholdProbability}];
  });
  goalComparisons[engine]={decisionsChanged:changed.length,finalTurn:{n:final.length,changed:final.filter(x=>x.thresholdChoice.cardId!==x.expectedChoice.cardId).length,meanGain:avg(final.map(x=>x.meanGain)),hitGain:avg(final.map(x=>x.hitGain)),rows:final.filter(x=>x.thresholdChoice.cardId!==x.expectedChoice.cardId)}};
 }
 return {provenance:primary.provenance,scenarios:[primary,secondary,expected].map(r=>({scenario:r.scenario,...r.summary})),goalComparisons,interpretation:'Exact final-turn effects are conditional on recorded first four cards; not whole-game effects. Scenario gains compare offer models within the same objective.'};
}
if(require.main===module){const [a,b,c,out]=process.argv.slice(2);if(!out)throw Error('Usage: node scripts/compare-offer-objectives.cjs TARGET2400 TARGET1500 EXPECTED2400 OUTPUT');const result=summarize(...[a,b,c].map(p=>JSON.parse(fs.readFileSync(p))));fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={summarize};
