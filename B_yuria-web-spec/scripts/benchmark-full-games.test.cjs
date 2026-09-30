const test=require('node:test'),assert=require('node:assert/strict');
const {playGame,seedFor}=require('./benchmark-full-games.cjs');
const {production}=require('./replay-offer-models.cjs');
test('whole games start empty, take legal offers, and recompute final score from their own state',()=>{
 for(const world of ['production','candidate'])for(const policy of ['production','candidate']){
  const game=playGame({world,policy,objective:{kind:'threshold',target:2400},game:7,simulations:16});
  assert.equal(game.turns.length,5);assert.equal(new Set(game.selected.map(c=>c.cardId)).size,5);
  for(const t of game.turns){assert.equal(t.selected.length,t.turn);assert.ok(t.offers.every(c=>!t.selected.slice(0,-1).some(p=>p.cardId===c.cardId)));}
  assert.equal(game.score,production.calculateScore(game.selected,()=>game.redUniform).finalScore);
 }
});
test('matched environment reproduces a policy trajectory and shares first offers across policies',()=>{
 const args={world:'candidate',policy:'production',objective:{kind:'expected'},game:4,simulations:16};
 const a=playGame(args),b=playGame(args),c=playGame({...args,policy:'candidate'});
 assert.deepEqual(a.turns,b.turns);assert.equal(a.score,b.score);assert.deepEqual(a.turns[0].offers,c.turns[0].offers);
 assert.notEqual(seedFor(1,1,1,0),seedFor(1,1,1,1));assert.notEqual(seedFor(1,1,1,0),seedFor(1,1,2,0));
});
test('Star removes exactly one own card at final settlement, never in the first four turns',()=>{
 const picks=['star','fool','strength','tower','magician'];
 const game=playGame({world:'production',policy:'production',objective:{kind:'expected'},game:2,simulations:1,
  offerOverride:(selected,turn)=>[{cardId:picks[turn-1],color:'blue'},...['world','sun','moon'].filter(id=>id!==picks[turn-1]&&!selected.some(c=>c.cardId===id)).slice(0,2).map(cardId=>({cardId,color:'red'}))],choiceOverride:offers=>offers[0]});
 assert.ok(game.turns.slice(0,4).every(t=>!t.selected.some(c=>c.removed)));assert.equal(game.selected.filter(c=>c.removed).length,1);assert.ok(!game.selected.find(c=>c.cardId==='star').removed);
});
