'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../core.js');

function quiet(g){g.items=[];g.powerups=[];g.powerupTimer=1000;g.hazards.forEach(h=>{h.delay=1000;});return g;}
function fresh(mode='campaign',tutorialSeen=true){const g=Core.createGame({seed:404,width:900,height:600});Core.start(g,mode,{tutorialSeen});return quiet(g);}
function practice(level,tutorialSeen=true){const g=fresh();assert.equal(Core.startPractice(g,level,10,{tutorialSeen}),true);return quiet(g);}
function advance(g,seconds,input){for(let left=seconds;left>1e-9;left-=.01)Core.step(g,Math.min(.01,left),input);}
function close(a,b){assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);}
function complete(g){const cfg=Core.levelConfig(g);g.levelCargo=cfg.goal;g.levelSmashes=cfg.smashGoal||0;g.player.x=15;g.player.y=15;g.invulnerable=2;Core.step(g,0);}
function upgraded(id,level=2){const g=practice(level-1);complete(g);assert.equal(g.mode,'upgrade');assert.equal(Core.chooseUpgrade(g,id),true);quiet(g);g.events=[];return g;}
function deliver(g,count){g.cargo=count;g.deliveryCooldown=0;g.player.x=g.station.x;g.player.y=g.station.y;Core.step(g,0);return g.events.filter(e=>e.type==='deliver').at(-1);}
function enterTutorial(id='standard'){
  const g=practice(2,false);complete(g);assert.equal(Core.chooseUpgrade(g,id),true);assert.equal(g.mode,'tutorial');g.events=[];return g;
}
function mainSnapshot(g){const copy={...g};delete copy.tutorial;delete copy.events;return JSON.stringify(copy);}
function forceFailure(g,reason='time'){g.mode='over';g.reason=reason;}

test('objectives expose capped cargo/smash progress, remaining and completion without mutating state',()=>{
  const g=practice(3);g.levelCargo=4;g.levelSmashes=1;const before=JSON.stringify(g);
  assert.deepEqual(Core.objectives(g),{cargo:{progress:4,goal:6,remaining:2,done:false},smash:{progress:1,goal:3,remaining:2,done:false},done:false,missing:[{type:'cargo',remaining:2},{type:'smash',remaining:2}]});
  assert.equal(JSON.stringify(g),before);
  g.levelCargo=999;g.levelSmashes=99;
  const complete=Core.objectives(g);assert.equal(complete.cargo.progress,6);assert.equal(complete.smash.progress,3);assert.equal(complete.done,true);assert.deepEqual(complete.missing,[]);
});

test('ordinary sectors treat their absent smash objective as complete',()=>{
  const g=fresh();const o=Core.objectives(g);assert.deepEqual(o.smash,{progress:0,goal:0,remaining:0,done:true});assert.equal(o.done,false);
  g.levelCargo=4;assert.equal(Core.objectives(g).done,true);
});

test('objective display clamps invalid or negative progress rather than inventing completion',()=>{
  const g=practice(3);g.levelCargo=-4;g.levelSmashes=NaN;
  assert.equal(Core.objectives(g).cargo.progress,0);assert.equal(Core.objectives(g).smash.progress,0);
  assert.equal(Core.objectives(g).done,false);g.levelCargo=2.9;assert.equal(Core.objectives(g).cargo.progress,2);
});

test('failure event states missing trial objectives without replacing score with progress',()=>{
  const g=practice(3);g.score=432;g.levelCargo=100;g.levelSmashes=1;g.stageElapsed=64.99;
  Core.step(g,.02);const event=g.events.find(e=>e.type==='over');
  assert.equal(g.score,432);assert.equal(event.score,432);assert.equal(event.reason,'time');
  assert.equal(event.objectives.cargo.progress,6);assert.equal(event.objectives.done,false);
  assert.deepEqual(event.objectives.missing,[{type:'smash',remaining:2}]);
  assert.equal(event.origin,'practice');assert.equal(event.recordEligible,false);
});

test('refit exports are immutable, mutually exclusive and match their documented stats',()=>{
  assert.deepEqual(Core.REFITS.map(r=>[r.id,r.capacity,r.cooldown,r.baseSpeed,r.cargoPenalty]),[
    ['standard',5,2.4,1,.015],['hauler',7,2.8,1,.035],['sprinter',3,1.35,1.08,.01]
  ]);
  assert.ok(Object.isFrozen(Core.REFITS));assert.ok(Core.REFITS.every(Object.isFrozen));
  for(const r of Core.REFITS){const g=upgraded(r.id);assert.equal(g.refit,r.id);assert.equal(Core.refit(g),r);assert.equal(Core.capacity(g),r.capacity);assert.equal(Core.boostCooldown(g),r.cooldown);}
});

test('payout supports all seven slots and safely clamps invalid counts',()=>{
  assert.deepEqual(Array.from({length:8},(_,i)=>Core.payout(i)),[0,100,240,450,720,1100,1500,1960]);
  for(const value of [-1,NaN,Infinity,undefined])assert.equal(Core.payout(value),0);
  assert.equal(Core.payout(8),1960);assert.equal(Core.payout(6.9),1500);
});

test('pickup and magnet both honor each refit capacity instead of the legacy constant',()=>{
  for(const r of Core.REFITS){
    const g=upgraded(r.id);g.magnetTime=8;
    g.items=Array.from({length:10},()=>({x:g.player.x+20,y:g.player.y,r:11,wait:0}));
    Core.step(g,0);assert.equal(g.cargo,r.capacity);assert.equal(g.collected,r.capacity);
    const spare=g.items.find(i=>i.wait===0);spare.x=g.player.x+70;const x=spare.x;Core.step(g,.05);assert.equal(spare.x,x);
  }
});

test('each refit full-hold preview exactly matches its delivered score at every combo tier',()=>{
  for(const r of Core.REFITS)for(const combo of [0,1,2,3,4,8]){
    const g=upgraded(r.id);g.cargo=r.capacity;g.combo=combo;g.comboTime=combo?10:0;
    const expected=Core.nextPayout(g),event=deliver(g,r.capacity);
    assert.equal(event.amount,expected,`${r.id} combo ${combo}`);assert.equal(event.cargo,r.capacity);
    assert.equal(expected,Core.payout(r.capacity)*Core.multiplier(combo+1));
  }
});

test('preview and delivery cannot over-credit cargo beyond the selected capacity',()=>{
  const g=upgraded('sprinter');g.cargo=99;assert.equal(Core.nextPayout(g),450);
  const event=deliver(g,99);assert.equal(event.amount,450);assert.equal(event.cargo,3);assert.equal(g.deliveredCargo,3);
});

test('dynamic cooldown and speed penalties match the chosen refit',()=>{
  for(const r of Core.REFITS){
    const empty=upgraded(r.id),loaded=upgraded(r.id);loaded.cargo=r.capacity;
    const ex=empty.player.x,lx=loaded.player.x;Core.step(empty,.05,{x:1});Core.step(loaded,.05,{x:1});
    close(empty.player.x-ex,340*r.baseSpeed*.05);close(loaded.player.x-lx,340*r.baseSpeed*(1-r.capacity*r.cargoPenalty)*.05);
    assert.equal(Core.boost(empty),true);assert.equal(empty.boostCooldown,r.cooldown);assert.equal(Core.boost(empty),false);
  }
});

test('choosing a new refit replaces rather than stacks its prior stats',()=>{
  const g=upgraded('hauler');complete(g);assert.equal(Core.chooseUpgrade(g,'sprinter'),true);
  assert.equal(g.refit,'sprinter');assert.equal(Core.capacity(g),3);assert.equal(Core.boostCooldown(g),1.35);assert.equal(Core.refit(g).baseSpeed,1.08);
});

test('non-final completion enters a real frozen upgrade intermission and rewards only once',()=>{
  const g=fresh();g.elapsed=14;g.stageElapsed=14;g.timeLeft=46;g.combo=2;g.comboTime=5;g.shieldTime=2;g.health=1;
  complete(g);assert.equal(g.mode,'upgrade');assert.equal(g.level,2);assert.equal(g.score,250);assert.equal(g.health,2);
  const event=g.events.find(e=>e.type==='upgrade');assert.equal(event.completedLevel,1);assert.equal(event.level,2);assert.equal(event.reward,250);assert.equal(event.name,Core.LEVELS[1].name);assert.equal(event.lesson,Core.LEVELS[1].lesson);
  const before=JSON.stringify(g);advance(g,30,{x:1});assert.equal(JSON.stringify(g),before);
  assert.equal(Core.boost(g),false);assert.equal(Core.pause(g),false);assert.equal(Core.resume(g),false);
  assert.equal(g.events.filter(e=>e.type==='upgrade').length,1);
});

test('invalid refit choices leave upgrade unchanged and valid choices can happen only once',()=>{
  const g=fresh();complete(g);const before=JSON.stringify(g);
  for(const id of ['',null,'unknown','toString',{},undefined]){assert.equal(Core.chooseUpgrade(g,id),false);assert.equal(JSON.stringify(g),before);}
  assert.equal(Core.chooseUpgrade(g,'hauler'),true);assert.equal(g.mode,'playing');assert.equal(g.pendingUpgrade,null);assert.equal(g.stageElapsed,0);assert.equal(g.timeLeft,65);assert.equal(g.elapsed,0);
  const after=JSON.stringify(g);assert.equal(Core.chooseUpgrade(g,'sprinter'),false);assert.equal(JSON.stringify(g),after);assert.equal(g.score,250);
});

test('upgrade carry is capped below both the next goal and actual old/new capacity',()=>{
  const g=upgraded('hauler',3);g.levelCargo=100;g.levelSmashes=3;Core.step(g,0);
  assert.equal(g.mode,'upgrade');assert.equal(g.level,4);assert.equal(g.levelCargo,6);
  assert.equal(Core.chooseUpgrade(g,'sprinter'),true);assert.equal(g.levelCargo,2);assert.equal(g.mode,'playing');
  const next=fresh('endless');next.level=10;next.refit='hauler';next.levelCargo=999;Core.step(next,0);
  assert.equal(next.mode,'upgrade');assert.equal(next.level,11);assert.equal(Core.levelConfig(next).goal,6);assert.equal(next.levelCargo,5);
  Core.chooseUpgrade(next,'hauler');assert.equal(next.levelCargo,5);Core.step(next,0);assert.equal(next.level,11);
});

test('selecting a smaller hold caps unsent cargo without granting score',()=>{
  const g=upgraded('hauler',3);g.cargo=7;g.levelCargo=6;g.levelSmashes=3;g.player.x=15;g.player.y=15;
  Core.step(g,0);const score=g.score;Core.chooseUpgrade(g,'sprinter');assert.equal(g.cargo,3);assert.equal(g.score,score);
});

test('final campaign completion wins directly without an upgrade and objectives remain complete',()=>{
  const g=practice(10);const expected=Core.levelConfig(g).reward+90*15;complete(g);
  assert.equal(g.mode,'over');assert.equal(g.reason,'victory');assert.equal(g.score,expected);assert.equal(g.pendingUpgrade,null);
  assert.equal(g.events.filter(e=>e.type==='upgrade').length,0);assert.equal(Core.objectives(g).done,true);
  assert.equal(g.events.find(e=>e.type==='over').objectives.done,true);
  assert.equal(Core.chooseUpgrade(g,'hauler'),false);assert.equal(Core.retryLevel(g),false);
});

test('endless sector 10 still upgrades rather than winning and keeps infinite sector time',()=>{
  const g=fresh('endless');g.level=10;complete(g);assert.equal(g.level,11);assert.equal(g.mode,'upgrade');
  assert.equal(g.events.filter(e=>e.type==='victory').length,0);Core.chooseUpgrade(g,'hauler');assert.equal(g.mode,'playing');assert.equal(g.timeLeft,Infinity);
});

test('first entry to sector 3 launches a separate fixed-size tutorial after the refit choice',()=>{
  const g=practice(2,false);complete(g);assert.equal(g.mode,'upgrade');assert.equal(g.tutorial,null);
  Core.chooseUpgrade(g,'standard');assert.equal(g.mode,'tutorial');assert.equal(g.tutorialSeen,false);
  assert.equal(g.tutorial.width,320);assert.equal(g.tutorial.height,120);assert.equal(g.tutorial.success,false);assert.equal(g.level,3);assert.equal(g.timeLeft,65);
  assert.equal(g.hazards.filter(h=>h.training).length,3);
});

test('tutorial movement and cooldown update no main-game clocks, score, health or physics',()=>{
  const g=enterTutorial('hauler');const before=mainSnapshot(g),x=g.tutorial.player.x;
  Core.step(g,.05,{x:1,y:1});assert.ok(g.tutorial.player.x>x);assert.equal(mainSnapshot(g),before);
  assert.equal(Core.boost(g),true);assert.equal(Core.boost(g),false);assert.equal(g.tutorial.cooldown,2.8);assert.equal(g.boostCooldown,0);
  Core.step(g,.05,{x:-1,y:0});assert.ok(g.tutorial.cooldown<2.8);assert.equal(mainSnapshot(g),before);
});

test('touching the tutorial target without boosting never completes or damages the real run',()=>{
  const g=enterTutorial(),score=g.score;g.tutorial.player.x=g.tutorial.target.x;g.tutorial.player.y=g.tutorial.target.y;
  Core.step(g,0);assert.equal(g.tutorial.success,false);assert.equal(g.health,3);assert.equal(g.score,score);
  assert.equal(Core.finishTutorial(g),false);assert.equal(g.mode,'tutorial');
});

test('a real tutorial dash succeeds once, awards no score, and requires explicit finish',()=>{
  const g=enterTutorial();const score=g.score,main=mainSnapshot(g);assert.equal(Core.boost(g),true);
  advance(g,.4,{x:1});assert.equal(g.tutorial.success,true);assert.equal(g.tutorial.target.destroyed,true);assert.equal(g.mode,'tutorial');
  assert.equal(g.events.filter(e=>e.type==='tutorialSuccess').length,1);assert.equal(g.score,score);assert.equal(mainSnapshot(g),main);
  assert.equal(Core.boost(g),false);advance(g,1);assert.equal(g.events.filter(e=>e.type==='tutorialSuccess').length,1);
  assert.equal(Core.finishTutorial(g),true);assert.equal(g.mode,'playing');assert.equal(g.tutorialSeen,true);assert.equal(g.tutorial,null);assert.equal(g.timeLeft,65);assert.equal(g.levelSmashes,0);
  assert.equal(Core.finishTutorial(g),false);assert.equal(Core.skipTutorial(g),false);
});

test('tutorial pause freezes its state and resumes tutorial instead of the live arena',()=>{
  const g=enterTutorial();Core.boost(g);assert.equal(Core.pause(g),true);assert.equal(g.mode,'paused');assert.equal(g.pausedFrom,'tutorial');
  const before=JSON.stringify(g);advance(g,10,{x:1});assert.equal(JSON.stringify(g),before);assert.equal(Core.boost(g),false);
  assert.equal(Core.pause(g),false);assert.equal(Core.resume(g),true);assert.equal(g.mode,'tutorial');assert.equal(g.pausedFrom,null);assert.equal(Core.resume(g),false);
});

test('skip is explicit, idempotent, marks seen and does not fake tutorial or stage success',()=>{
  const g=enterTutorial();const score=g.score;assert.equal(Core.skipTutorial(g),true);assert.equal(g.mode,'playing');assert.equal(g.tutorialSeen,true);
  assert.equal(g.score,score);assert.equal(g.levelCargo,0);assert.equal(g.levelSmashes,0);assert.equal(g.events.filter(e=>e.type==='tutorialSuccess').length,0);
  const before=JSON.stringify(g);assert.equal(Core.skipTutorial(g),false);assert.equal(JSON.stringify(g),before);
});

test('a paused tutorial can be skipped safely without resuming it later',()=>{
  const g=enterTutorial();Core.pause(g);assert.equal(Core.skipTutorial(g),true);assert.equal(g.mode,'playing');assert.equal(g.pausedFrom,null);assert.equal(Core.resume(g),false);
});

test('seen tutorials are not repeated in campaign, practice or retry entry',()=>{
  const g=practice(2,true);complete(g);Core.chooseUpgrade(g,'standard');assert.equal(g.mode,'playing');assert.equal(g.tutorial,null);
  Core.startPractice(g,3,10,{tutorialSeen:true});assert.equal(g.mode,'playing');forceFailure(g);Core.retryLevel(g);assert.equal(g.mode,'playing');assert.equal(g.tutorialSeen,true);
});

test('tutorial simulation remains fixed at 320×120 through main-arena resize',()=>{
  const g=enterTutorial();const before=JSON.stringify(g.tutorial);Core.resize(g,320,400);
  assert.equal(JSON.stringify(g.tutorial),before);assert.equal(g.tutorial.width,320);assert.equal(g.tutorial.height,120);
});

test('tutorial boundary movement and invalid frame durations remain safe',()=>{
  const g=enterTutorial();const x=g.tutorial.player.x;Core.step(g,NaN,{x:1});assert.equal(g.tutorial.player.x,x);
  advance(g,5,{x:-1,y:-1});assert.equal(g.tutorial.player.x,12);assert.equal(g.tutorial.player.y,12);
  advance(g,5,{x:1,y:1});assert.equal(g.tutorial.player.x,308);assert.equal(g.tutorial.player.y,108);assert.equal(g.tutorial.success,false);
});

test('fresh campaign and endless starts are standard-refit full-run record candidates',()=>{
  const g=upgraded('hauler');for(const mode of ['campaign','endless']){
    Core.start(g,mode,{tutorialSeen:true});assert.equal(g.mode,'playing');assert.equal(g.runMode,mode);assert.equal(g.origin,'fresh');assert.equal(g.recordEligible,true);
    assert.equal(g.refit,'standard');assert.equal(g.score,0);assert.equal(g.level,1);assert.equal(g.health,3);assert.equal(g.tutorialSeen,true);assert.equal(g.timeLeft,mode==='endless'?Infinity:60);
  }
});

test('practice validates locked, invalid and out-of-range selections before any mutation',()=>{
  const g=fresh();g.score=99;const before=JSON.stringify(g);
  for(const [level,max] of [[0,10],[11,10],[3,2],[1,0],[1,11],[2.5,10],[NaN,10],['2',10],[1,'10'],[1,Infinity]]){
    assert.equal(Core.startPractice(g,level,max),false);assert.equal(JSON.stringify(g),before);
  }
});

test('every unlocked practice stage starts fresh with exactly that stage configuration',()=>{
  for(let level=1;level<=10;level++){
    const g=upgraded('hauler');g.score=1000;g.health=1;
    assert.equal(Core.startPractice(g,level,level,{tutorialSeen:true}),true);assert.equal(g.mode,'playing');assert.equal(g.level,level);assert.equal(g.runMode,'campaign');
    assert.equal(g.origin,'practice');assert.equal(g.recordEligible,false);assert.equal(g.score,0);assert.equal(g.health,3);assert.equal(g.refit,'standard');assert.equal(g.cargo,0);
    assert.equal(g.timeLeft,Core.levelConfig(g).seconds);assert.equal(g.stageElapsed,0);assert.equal(g.elapsed,0);assert.equal(g.pendingUpgrade,null);
    assert.equal(g.mines.length>0,Core.has(g,'mines'));assert.equal(g.drones.length>0,Core.has(g,'drones'));assert.equal(g.portals.length>0,Core.has(g,'portals'));
  }
});

test('practice stage 3 teaches an unseen tutorial but never becomes record eligible',()=>{
  const g=fresh();assert.equal(Core.startPractice(g,3,3,{tutorialSeen:false}),true);assert.equal(g.mode,'tutorial');assert.equal(g.origin,'practice');assert.equal(g.recordEligible,false);
  Core.skipTutorial(g);complete(g);Core.chooseUpgrade(g,'hauler');assert.equal(g.recordEligible,false);assert.equal(g.origin,'practice');
});

test('retry only accepts non-victory game-over and preserves all invalid caller states',()=>{
  for(const mode of ['ready','playing','paused','upgrade','tutorial']){
    const g=fresh();g.mode=mode;const before=JSON.stringify(g);assert.equal(Core.retryLevel(g),false);assert.equal(JSON.stringify(g),before);
  }
  const won=practice(10);complete(won);const before=JSON.stringify(won);assert.equal(Core.retryLevel(won),false);assert.equal(JSON.stringify(won),before);
});

test('failed-sector retry preserves mode, stage, refit and tutorialSeen but clears all run resources',()=>{
  for(const mode of ['campaign','endless']){
    const g=fresh(mode);g.level=7;g.refit='sprinter';g.score=5000;g.health=0;g.cargo=3;g.combo=7;g.comboTime=8;g.maxCombo=9;g.levelCargo=5;g.levelSmashes=8;
    g.deliveredCargo=25;g.deliveries=8;g.elapsed=200;g.stageElapsed=40;g.magnetTime=8;g.shieldTime=6;g.slowTime=6;g.boostTime=.4;g.boostCooldown=1;g.portalCooldown=1;g.stormRadius=123;
    forceFailure(g,'health');assert.equal(Core.retryLevel(g),true);assert.equal(g.mode,'playing');assert.equal(g.runMode,mode);assert.equal(g.level,7);assert.equal(g.refit,'sprinter');assert.equal(g.tutorialSeen,true);
    assert.equal(g.origin,'retry');assert.equal(g.recordEligible,false);assert.equal(g.health,3);assert.equal(g.timeLeft,mode==='endless'?Infinity:75);
    for(const field of ['score','cargo','combo','comboTime','maxCombo','levelCargo','levelSmashes','deliveredCargo','deliveries','elapsed','stageElapsed','magnetTime','shieldTime','slowTime','boostTime','boostCooldown','portalCooldown'])assert.equal(g[field],0,field);
    assert.equal(g.stormRadius,-1);assert.equal(g.drones.length,2);assert.equal(g.reason,'');assert.deepEqual(g.events,[]);
    const before=JSON.stringify(g);assert.equal(Core.retryLevel(g),false);assert.equal(JSON.stringify(g),before);
  }
});

test('retry remains ineligible after upgrades and repeated failures; full restart resets eligibility',()=>{
  const g=upgraded('hauler');forceFailure(g);Core.retryLevel(g);assert.equal(g.recordEligible,false);
  complete(g);Core.chooseUpgrade(g,'sprinter');assert.equal(g.recordEligible,false);assert.equal(g.refit,'sprinter');
  forceFailure(g);Core.retryLevel(g);assert.equal(g.recordEligible,false);assert.equal(g.refit,'sprinter');
  Core.start(g,'campaign',{tutorialSeen:true});assert.equal(g.recordEligible,true);assert.equal(g.origin,'fresh');assert.equal(g.level,1);assert.equal(g.refit,'standard');
});

test('over events carry eligibility correctly for fresh death and practice/retry death',()=>{
  for(const origin of ['fresh','practice','retry']){
    const g=origin==='fresh'?fresh('endless'):practice(1);
    if(origin==='retry'){forceFailure(g);Core.retryLevel(g);}
    quiet(g);g.health=1;g.invulnerable=0;Object.assign(g.hazards[0],{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0});Core.step(g,0);
    const event=g.events.find(e=>e.type==='over');assert.equal(event.origin,origin);assert.equal(event.recordEligible,origin==='fresh');assert.equal(event.reason,'health');
  }
});

test('return-to-menu aborts upgrade, tutorial, paused, practice and live runs without settlement',()=>{
  const states=[];const upgrade=fresh();complete(upgrade);states.push(upgrade,enterTutorial());
  const paused=enterTutorial();Core.pause(paused);states.push(paused,practice(7),upgraded('hauler'));
  for(const g of states){g.score=777;assert.equal(Core.toMenu(g,'endless',{tutorialSeen:true}),true);
    assert.equal(g.mode,'ready');assert.equal(g.runMode,'endless');assert.equal(g.refit,'standard');assert.equal(g.origin,'fresh');assert.equal(g.score,0);assert.equal(g.level,1);
    assert.equal(g.recordEligible,true);assert.equal(g.tutorialSeen,true);assert.equal(g.tutorial,null);assert.equal(g.pendingUpgrade,null);assert.equal(g.pausedFrom,null);assert.equal(g.timeLeft,Infinity);assert.deepEqual(g.events,[]);
    const before=JSON.stringify(g);Core.step(g,.05,{x:1});assert.equal(JSON.stringify(g),before);
  }
});

test('switching mode through the menu drops previous pending upgrades and cannot resume them',()=>{
  const g=fresh('endless');complete(g);Core.toMenu(g,'campaign',{tutorialSeen:false});
  assert.equal(g.mode,'ready');assert.equal(g.runMode,'campaign');assert.equal(g.timeLeft,60);assert.equal(g.tutorialSeen,false);
  assert.equal(Core.chooseUpgrade(g,'hauler'),false);assert.equal(Core.resume(g),false);assert.equal(Core.finishTutorial(g),false);assert.equal(Core.skipTutorial(g),false);
});

test('record eligibility survives a full fresh campaign and is still false for practice victory',()=>{
  for(const isPractice of [false,true]){
    const g=isPractice?practice(1):fresh();
    for(let level=1;level<=10;level++){
      assert.equal(g.level,level);complete(g);
      if(level<10){assert.equal(g.mode,'upgrade');assert.equal(Core.chooseUpgrade(g,Core.REFITS[level%3].id),true);quiet(g);}
    }
    assert.equal(g.mode,'over');assert.equal(g.reason,'victory');assert.equal(g.recordEligible,!isPractice);assert.equal(Core.objectives(g).done,true);
    assert.equal(g.events.filter(e=>e.type==='upgrade').length,9);assert.equal(g.events.filter(e=>e.type==='victory').length,1);assert.equal(g.events.find(e=>e.type==='over').recordEligible,!isPractice);
  }
});


test('upgrade objectives never inherit the previous sector smash count',()=>{
  const g=practice(2);g.levelSmashes=20;g.levelCargo=6;Core.step(g,0);
  assert.equal(g.mode,'upgrade');assert.equal(g.level,3);assert.equal(g.levelSmashes,0);
  assert.equal(Core.objectives(g).smash.progress,0);assert.equal(Core.objectives(g).smash.remaining,3);
});

test('legacy standard constants and exported dynamic refit stats remain consistent',()=>{
  const g=fresh();assert.equal(Core.CAPACITY,Core.capacity(g));assert.equal(Core.BOOST_COOLDOWN,Core.boostCooldown(g));
  Core.start(g,'campaign',{tutorialSeen:'false'});assert.equal(g.tutorialSeen,false);
  Core.toMenu(g,'campaign',{tutorialSeen:true});assert.equal(g.tutorialSeen,true);
});
