const test=require('node:test');
const assert=require('node:assert/strict');
const {compileSet,probability,sampleOffer}=require('./benchmark-offer-models.cjs');
const model={family:'card',early:[10,10,5],final:[5,10,20]};
function random(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
test('sampler excludes selected cards and produces three distinct cards/colors',()=>{
  const selected=['fool','world','tower','strength'].map(cardId=>({cardId})),rng=random(15);
  for(let i=0;i<1000;i++){const offer=sampleOffer(model,rng,selected,5);assert.equal(new Set(offer.map(x=>x.cardId)).size,3);assert.equal(new Set(offer.map(x=>x.color)).size,3);assert.ok(offer.every(x=>!selected.some(c=>c.cardId===x.cardId)));}
});
test('fixed seed reproduces offers',()=>{assert.deepEqual(sampleOffer(model,random(100),[],1),sampleOffer(model,random(100),[],1));});
test('card weights first-pick category frequency matches independent analytic mass',()=>{
  const rng=random(21),n=50000;let score=0;
  for(let i=0;i<n;i++){const id=sampleOffer(model,rng,[],1)[0].cardId;if(['fool','magician','high_priestess','empress','emperor','hierophant','lovers','chariot','hermit','hanged_man','devil'].includes(id))score++;}
  assert.ok(Math.abs(score/n-110/195)<.01);
});
test('unordered likelihood sums ordered outcomes and rejects unavailable cards',()=>{
  const pool=['fool','strength','tower'];
  assert.ok(Math.abs(probability(compileSet(pool,pool),model.early,'card')-1)<1e-12);
  assert.equal(probability(compileSet(['fool','world','tower'],pool),model.early,'card'),0);
});
test('sampler handles exhausted category and rejects insufficient pool',()=>{
  const all=['fool','magician','high_priestess','empress','emperor','hierophant','lovers','chariot','hermit','hanged_man','devil','strength','wheel_of_fortune','justice','death','temperance','judgement','tower','star','moon','sun','world'];
  const selected=all.slice(0,19).map(cardId=>({cardId}));
  assert.equal(sampleOffer({...model,family:'category'},random(1),selected,5).length,3);
  assert.throws(()=>sampleOffer(model,random(1),all.slice(0,20).map(cardId=>({cardId})),5));
});
