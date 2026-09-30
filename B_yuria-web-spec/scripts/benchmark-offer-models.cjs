// Research only: evaluates candidate-set probabilities, never changes production recommendations.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const {execFileSync} = require('node:child_process');
const {buildSync} = require('esbuild');
const root = path.resolve(__dirname, '..');
const bundle = buildSync({stdin:{contents:'export * from "./src/domain"; export * from "./src/real-game-record";',resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false});
const loaded = new Module(path.join(root,'research-offers.cjs'),module);
loaded._compile(bundle.outputFiles[0].text,path.join(root,'research-offers.cjs'));
const E = loaded.exports;
const categories = ['score','multiplier','special'];
const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const early = [10,10,5], final = [5,10,20];

function compileSet(ids, available) {
  if(new Set(ids).size!==3 || ids.some(id=>!available.includes(id))) return null;
  const counts = categories.map(k=>available.filter(id=>E.CARDS[id].category===k).length);
  return permutations.map(order=>{
    const left = [...counts];
    return order.map(i=>{const category = categories.indexOf(E.CARDS[ids[i]].category);const step={counts:[...left],category};left[category]--;return step;});
  });
}
function probability(paths, weights, family) {
  if(!paths)return 0;
  return paths.reduce((sum,steps)=>sum+steps.reduce((p,{counts,category})=>{
    const denominator = counts.reduce((s,n,k)=>s+(family==='card'?n:n>0?1:0)*weights[k],0);
    return p*weights[category]/denominator/(family==='category'?counts[category]:1);
  },1),0);
}
function sampleOffer(model,rng,selected,turn){
  const weights=turn===5?model.final:model.early;
  const used=new Set(selected.map(c=>c.cardId));
  let pool=Object.keys(E.CARDS).filter(id=>!used.has(id));
  if(pool.length<3)throw Error('At least three available cards required');
  const colors=['blue','purple','red'];
  for(let i=colors.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[colors[i],colors[j]]=[colors[j],colors[i]];}
  return colors.map(color=>{
    const counts=categories.map(k=>pool.filter(id=>E.CARDS[id].category===k).length);
    const masses=pool.map(id=>{const k=categories.indexOf(E.CARDS[id].category);return weights[k]/(model.family==='category'?counts[k]:1);});
    let roll=rng()*masses.reduce((s,x)=>s+x,0),index=pool.length-1;
    for(let i=0;i<pool.length;i++){roll-=masses[i];if(roll<0){index=i;break;}}
    const [cardId]=pool.splice(index,1);return {cardId,color};
  });
}
function nll(rows,weights,family){return rows.reduce((s,r)=>s-Math.log(probability(r.paths,weights,family)),0)/rows.length;}
function fit(rows,family){
  let best={loss:Infinity,x:0,y:0};
  function search(xs,ys){for(const x of xs)for(const y of ys){const loss=nll(rows,[Math.exp(x),1,Math.exp(y)],family);if(loss<best.loss)best={loss,x,y};}}
  const grid=Array.from({length:25},(_,i)=>-3+i*.25);search(grid,grid);
  const {x,y}=best;search(Array.from({length:11},(_,i)=>x-.25+i*.05),Array.from({length:11},(_,i)=>y-.25+i*.05));
  return {weights:[Math.exp(best.x),1,Math.exp(best.y)],loss:best.loss,atBoundary:Math.abs(best.x)>=3||Math.abs(best.y)>=3};
}
function tests(){
  const ids=Object.keys(E.CARDS);const available=['fool','magician','strength','tower'];
  for(const family of ['category','card']){
    let sum=0;
    for(let a=0;a<available.length;a++)for(let b=a+1;b<available.length;b++)for(let c=b+1;c<available.length;c++)sum+=probability(compileSet([available[a],available[b],available[c]],available),early,family);
    assert.ok(Math.abs(sum-1)<1e-12,'set probabilities normalize even when a category is exhausted');
    const set=['fool','strength','tower'];assert.ok(Math.abs(probability(compileSet(set,available),early,family)-probability(compileSet([...set].reverse(),available),early,family))<1e-12,'set order invariance within floating-point tolerance');
    assert.equal(probability(compileSet(['fool','fool','tower'],available),early,family),0);
    assert.equal(probability(compileSet(['fool','strength','world'],available),early,family),0);
  }
  const set=['fool','strength','tower'];const p=probability(compileSet(set,ids),early,'category');
  assert.ok(Math.abs(p-6*(10/25/11)*(10/25/6)*(5/25/5))<1e-12,'production-category probability matches analytic case');
  console.log('5 probability invariants PASS');
}
function main(){
  tests();if(process.argv[2]==='--self-test')return;
  const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/benchmark-offer-models.cjs INPUT OUTPUT');
  const bytes=fs.readFileSync(input),envelope=JSON.parse(bytes),raw=envelope.games;
  assert.ok(raw.every(E.isValidGameRecord),'invalid record: stop rather than silently drop');
  const sorted=raw.map((g,i)=>({g,ordinal:i+1})).sort((a,b)=>a.g.createdAt.localeCompare(b.g.createdAt)||a.ordinal-b.ordinal);
  const trainEnd=Math.floor(sorted.length*.6),validationEnd=Math.floor(sorted.length*.8);
  const partitions={train:sorted.slice(0,trainEnd),validation:sorted.slice(trainEnd,validationEnd),test:sorted.slice(validationEnd)};
  const excluded=[];
  const rows=Object.fromEntries(Object.entries(partitions).map(([split,games])=>[split,games.flatMap(({g,ordinal})=>g.rounds.flatMap((r,index)=>{
    if(!r.offers){excluded.push({split,ordinal,turn:r.turn,reason:'missing offers'});return [];}
    const used=new Set(g.rounds.slice(0,index).map(x=>x.chosen.cardId));
    const paths=compileSet(r.offers.map(o=>o.cardId),Object.keys(E.CARDS).filter(id=>!used.has(id)));
    if(!paths){excluded.push({split,ordinal,turn:r.turn,reason:'duplicate or previously selected offer'});return [];}
    return [{ordinal,turn:r.turn,paths}];
  }))]));
  const models=[{name:'production-category',family:'category',early,final},{name:'uniform-card',family:'card',early:[1,1,1],final:[1,1,1]},{name:'fixed-card-weights',family:'card',early,final}];
  for(const family of ['category','card']){
    const fittedEarly=fit(rows.train.filter(r=>r.turn<5),family),fittedFinal=fit(rows.train.filter(r=>r.turn===5),family);
    models.push({name:`fitted-${family}`,family,early:fittedEarly.weights,final:fittedFinal.weights,fit:{early:fittedEarly,final:fittedFinal}});
  }
  function metrics(model,split){const rs=rows[split];return {n:rs.length,nll:rs.reduce((s,r)=>s-Math.log(probability(r.paths,r.turn===5?model.final:model.early,model.family)),0)/rs.length,byTurn:[1,2,3,4,5].map(turn=>({turn,nll:nll(rs.filter(r=>r.turn===turn),turn===5?model.final:model.early,model.family)}))};}
  const evaluation=models.map(model=>({...model,train:metrics(model,'train'),validation:metrics(model,'validation')}));
  const chosen=[...evaluation].sort((a,b)=>a.validation.nll-b.validation.nll)[0].name;
  const rng=E.mulberry32(20260930),baseline=models[0];
  function gains(model){return partitions.test.map(({ordinal})=>{
    const rs=rows.test.filter(r=>r.ordinal===ordinal);return rs.length?rs.reduce((s,r)=>s+Math.log(probability(r.paths,r.turn===5?model.final:model.early,model.family)/probability(r.paths,r.turn===5?baseline.final:baseline.early,baseline.family)),0)/rs.length:null;
  }).filter(x=>x!==null);}
  const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
  for(const m of evaluation){m.test=metrics(m,'test');const gs=gains(m),draws=Array.from({length:10000},()=>avg(Array.from({length:gs.length},()=>gs[Math.floor(rng()*gs.length)]))).sort((a,b)=>a-b);m.testGainVsProduction={mean:avg(gs),CI95:[draws[249],draws[9749]],bootstrapUnit:'game',n:gs.length};}
  const report={provenance:{inputSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),seed:20260930,bootstrapSamples:10000},limitations:['Historical offers were inspected in the prior audit; this chronological holdout is exploratory, not pristine prospective evidence.','Scores, activations, colors and recommendations are not fitting targets; this benchmark cannot prove score uplift.','Likelihood marginalizes all six card orders; conditions on actual previously selected identities.','Cards within categories have equal weight; color-card dependence and changed future policy are not modeled.'],splits:Object.fromEntries(Object.entries(partitions).map(([key,gs])=>[key,{games:gs.length,rows:rows[key].length,firstAt:gs[0].g.createdAt,lastAt:gs.at(-1).g.createdAt,engines:gs.reduce((o,{g})=>{o[g.engineVersion]=(o[g.engineVersion]||0)+1;return o;},{}),missingActualScores:gs.filter(({g})=>g.actualFinalScore===null).length}])),excluded,chosenByValidation:chosen,models:evaluation};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({splits:report.splits,excluded,chosen,models:evaluation.map(m=>({name:m.name,early:m.early,final:m.final,validation:m.validation.nll,test:m.test.nll,gain:m.testGainVsProduction}))},null,2));
}
if(require.main===module)main();
module.exports={compileSet,probability,fit,sampleOffer};
