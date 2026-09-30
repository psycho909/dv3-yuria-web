// Research follow-up: independent decision seeds on the changed states of the PRIMARY 2400 benchmark.
const fs=require('node:fs'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {production,candidate,replayState,scenarioSettings}=require('./replay-offer-models.cjs');
function main(){
 const [input,primaryPath,output]=process.argv.slice(2);if(!input||!primaryPath||!output)throw Error('Usage: node scripts/check-offer-ranking-stability.cjs INPUT PRIMARY.json OUTPUT.json');
 const bytes=fs.readFileSync(input),games=JSON.parse(bytes).games,primary=JSON.parse(fs.readFileSync(primaryPath));
 assert.equal(primary.scenario,'target2400');assert.equal(primary.provenance.inputSHA256,crypto.createHash('sha256').update(bytes).digest('hex'));
 const rows=[],seeds=[20260931,20260932],simulations=primary.provenance.simulations;
 for(const row of primary.rows.filter(r=>r.changed)){
  const g=games[row.ordinal-1],round=g.rounds[row.turn-1],state=replayState(g,row.turn-1),settings=scenarioSettings(round,'target2400');
  const choices=[{seed:primary.provenance.seed,production:row.production.ranked[0].candidate,candidate:row.candidate.ranked[0].candidate}];
  for(const seed of seeds){
   const args=[state,round.offers.map(({cardId,color})=>({cardId,color})),settings.objective,simulations,seed,g.rulesSnapshot,settings.target];
   choices.push({seed,production:production.recommend(...args).ranked[0].candidate,candidate:candidate.recommend(...args).ranked[0].candidate});
  }
  rows.push({ordinal:row.ordinal,turn:row.turn,choices,productionStable:choices.every(x=>x.production.cardId===choices[0].production.cardId),candidateStable:choices.every(x=>x.candidate.cardId===choices[0].candidate.cardId),changedAllSeeds:choices.every(x=>x.production.cardId!==x.candidate.cardId)});
  console.log(`stability checked ${rows.length}/${primary.summary.changed}`);
 }
 const report={provenance:{inputSHA256:primary.provenance.inputSHA256,domainSHA256:primary.provenance.domainSHA256,primarySeed:primary.provenance.seed,extraSeeds:seeds,simulations},scope:'Only states whose 2400 recommendation changed in primary run; not global ranking stability.',summary:{n:rows.length,productionStable:rows.filter(r=>r.productionStable).length,candidateStable:rows.filter(r=>r.candidateStable).length,bothStable:rows.filter(r=>r.productionStable&&r.candidateStable).length,changedAllSeeds:rows.filter(r=>r.changedAllSeeds).length},rows};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
}
if(require.main===module)main();
