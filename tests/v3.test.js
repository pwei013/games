'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

function fresh(runMode='campaign',width=900,height=600) {
  const g=Core.createGame({seed:301,width,height});Core.start(g,runMode);
  g.items=[];g.powerups=[];g.powerupTimer=1000;g.hazards.forEach(h=>{h.delay=1000;});
  return g;
}
// Enter through the real progress/configuration path, not by fabricating zone objects.
function sector(number,runMode='campaign') {
  const g=fresh(runMode);
  if(number>1){g.level=number-1;g.levelCargo=Core.levelConfig(g).goal;g.levelSmashes=Core.levelConfig(g).smashGoal||0;Core.step(g,0);}
  assert.equal(g.level,number);
  g.items=[];g.powerups=[];g.powerupTimer=1000;g.events=[];g.invulnerable=0;
  g.hazards.forEach(h=>{h.delay=1000;});
  return g;
}
function advance(g,seconds,input) {
  const frames=Math.floor(seconds/.05);
  for(let i=0;i<frames;i++)Core.step(g,.05,input);
  const remainder=seconds-frames*.05;if(remainder>1e-9)Core.step(g,remainder,input);
}
function close(actual,expected,epsilon=1e-8){assert.ok(Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);}
function safeSpot(g){g.player.x=15;g.player.y=15;g.cargo=0;}
function quiet(g){g.hazards.forEach(h=>{h.delay=1000;});g.items=[];g.powerups=[];g.powerupTimer=1000;}
function smashAtPlayer(g,index=0) {
  g.boostCooldown=0;Core.boost(g);
  Object.assign(g.hazards[index],{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0});
  Core.step(g,0);
}

test('ten campaign sectors introduce distinct mechanics with explicit goals and deadlines',()=>{
  assert.equal(Core.LEVELS.length,10);
  assert.deepEqual(Core.LEVELS.map(x=>x.goal),[4,6,6,7,8,8,9,9,10,12]);
  assert.deepEqual(Core.LEVELS.map(x=>x.seconds),[60,65,65,70,70,75,75,80,85,90]);
  assert.deepEqual(Core.LEVELS.map(x=>x.mechanics),[[],['magnet'],['smash'],['mines'],['portals'],['wind','portals'],['drones'],['moving','wind'],['storm','portals'],['mines','drones','moving','storm']]);
  assert.equal(Core.LEVELS[2].smashGoal,3);
  for(const cfg of Core.LEVELS)assert.ok(cfg.name&&cfg.lesson&&cfg.reward>0);
});

test('endless starts with Infinity immediately, before any simulation frame',()=>{
  const g=fresh('endless');assert.equal(g.runMode,'endless');assert.equal(g.timeLeft,Infinity);
});

test('level transition refreshes only the sector clock, not total elapsed time',()=>{
  const g=fresh();g.elapsed=50;g.stageElapsed=50;g.timeLeft=10;g.levelCargo=4;
  Core.step(g,0);assert.equal(g.level,2);assert.equal(g.elapsed,50);assert.equal(g.stageElapsed,0);assert.equal(g.timeLeft,65);
  Core.step(g,.05);close(g.elapsed,50.05);close(g.stageElapsed,.05);close(g.timeLeft,64.95);
});

test('all ten sector deadlines end the campaign exactly once',()=>{
  for(let level=1;level<=10;level++){
    const g=sector(level);g.stageElapsed=Core.levelConfig(g).seconds-.01;g.elapsed=800;
    Core.step(g,.02);assert.equal(g.mode,'over',`sector ${level}`);assert.equal(g.reason,'time');assert.equal(g.timeLeft,0);
    assert.equal(g.events.filter(e=>e.type==='over').length,1);
    Core.step(g,.05);assert.equal(g.events.filter(e=>e.type==='over').length,1);
  }
});

test('overall elapsed time alone cannot expire a fresh sector',()=>{
  const g=fresh();g.elapsed=900;Core.step(g,.05);assert.equal(g.mode,'playing');close(g.timeLeft,59.95);
});

test('smash trial needs cargo AND three sector-local smashes',()=>{
  const g=sector(3);g.levelCargo=6;Core.step(g,0);assert.equal(g.level,3);
  smashAtPlayer(g);smashAtPlayer(g);assert.equal(g.level,3);assert.equal(g.levelSmashes,2);
  smashAtPlayer(g);assert.equal(g.level,4);assert.equal(g.levelSmashes,0);assert.equal(g.smashed,3);
  const other=sector(3);other.levelSmashes=3;Core.step(other,0);assert.equal(other.level,3);
});

test('prior-sector smash totals do not satisfy the trial target',()=>{
  const g=fresh();g.level=2;g.levelCargo=6;g.smashed=20;g.levelSmashes=20;Core.step(g,0);
  assert.equal(g.level,3);assert.equal(g.levelSmashes,0);assert.equal(g.smashed,20);
  g.levelCargo=6;Core.step(g,0);assert.equal(g.level,3);
});

test('trial configuration provides three stationary practice asteroids',()=>{
  const g=fresh();g.level=2;g.levelCargo=6;Core.step(g,0);
  const targets=g.hazards.filter(h=>h.vx===0&&h.vy===0&&h.r===24);
  assert.equal(targets.length,3);assert.ok(targets.every(h=>h.delay===0));
});

test('ordinary goal overshoot carries into the next sector and health stays capped',()=>{
  const g=fresh();g.levelCargo=5;g.health=3;Core.step(g,0);
  assert.equal(g.level,2);assert.equal(g.levelCargo,1);assert.equal(g.health,3);assert.equal(g.timeLeft,65);
});

test('mine pulse has safe and active intervals and active contact damages once per grace period',()=>{
  const g=sector(4),mine=g.mines[0];g.player.x=mine.x;g.player.y=mine.y;
  g.stageElapsed=1;Core.step(g,0);assert.equal(mine.active,false);assert.equal(g.health,3);
  g.stageElapsed=2.6;Core.step(g,0);assert.equal(mine.active,true);assert.equal(g.health,2);
  Core.step(g,0);assert.equal(g.health,2);assert.equal(g.events.filter(e=>e.type==='hit').length,1);
});

test('boost destroys a mine for 60 points, with a five-second respawn delay',()=>{
  const g=sector(4),mine=g.mines[0],before=g.score;
  g.player.x=mine.x;g.player.y=mine.y;g.stageElapsed=2.6;Core.boost(g);Core.step(g,0);
  assert.equal(g.health,3);assert.equal(g.score,before+60);assert.equal(g.smashed,1);assert.equal(mine.wait,5);
  g.boostTime=0;g.invulnerable=0;Core.step(g,0);assert.equal(g.health,3);assert.equal(g.smashed,1);
  safeSpot(g);advance(g,5.1);assert.ok(mine.wait<=0);
});

test('shield blocks an active mine without converting it into a smash',()=>{
  const g=sector(4),mine=g.mines[0];g.player.x=mine.x;g.player.y=mine.y;g.stageElapsed=2.6;g.shieldTime=6;
  Core.step(g,0);assert.equal(g.health,3);assert.equal(g.smashed,0);assert.equal(mine.wait,0);
});

test('portal transports to its pair, offsets the exit, and applies cooldown plus grace',()=>{
  const g=sector(5),entry=g.portals[0],exit=g.portals[1];
  g.player.x=entry.x;g.player.y=entry.y;g.player.dx=1;g.player.dy=0;
  Core.step(g,0);close(g.player.x,exit.x+32);close(g.player.y,exit.y);
  assert.equal(g.portalCooldown,1.4);assert.equal(g.invulnerable,.6);assert.equal(g.events.filter(e=>e.type==='teleport').length,1);
  g.player.x=exit.x;g.player.y=exit.y;Core.step(g,0);assert.equal(g.events.filter(e=>e.type==='teleport').length,1);
  g.portalCooldown=0;Core.step(g,0);assert.equal(g.events.filter(e=>e.type==='teleport').length,2);close(g.player.x,entry.x+32);
});

test('portal exit is clamped inside the resized mobile arena',()=>{
  const g=sector(5);Core.resize(g,280,300);g.player.x=g.portals[0].x;g.player.y=g.portals[0].y;g.player.dx=1;g.player.dy=0;
  Core.step(g,0);assert.ok(g.player.x>=15&&g.player.x<=265);assert.ok(g.player.y>=15&&g.player.y<=285);
});

test('wind pushes inside its band, reverses every six seconds, and leaves other rows alone',()=>{
  const g=sector(6);g.player.x=400;g.player.y=g.height*.5;
  Core.step(g,.05);close(g.player.x,404.4);
  g.stageElapsed=6;Core.step(g,.05);close(g.player.x,400);
  g.player.y=20;Core.step(g,.05);close(g.player.x,400);
});

test('boost bypasses wind force and slow-time does not alter wind strength',()=>{
  const a=sector(6),b=sector(6);for(const g of [a,b]){g.player.x=400;g.player.y=300;g.player.dx=0;g.player.dy=1;Core.boost(g);}
  a.slowTime=6;Core.step(a,.05);Core.step(b,.05);close(a.player.x,400);close(a.player.y,b.player.y);
});

test('drones home toward the player after their activation delay',()=>{
  const g=sector(7),drone=g.drones[0];g.player.x=450;g.player.y=400;
  const x=drone.x,y=drone.y;Core.step(g,.05);assert.equal(drone.x,x);assert.equal(drone.y,y);
  drone.wait=0;Core.step(g,.05);assert.ok(drone.x>x&&drone.y>y);
  const before=Math.hypot(drone.x-g.player.x,drone.y-g.player.y);advance(g,.5);
  assert.ok(Math.hypot(drone.x-g.player.x,drone.y-g.player.y)<before);
});

test('slow-time reduces drone pursuit speed',()=>{
  const a=sector(7),b=sector(7);a.slowTime=6;
  for(const g of [a,b]){g.player.x=450;g.player.y=400;g.drones[0].wait=0;}
  const x=a.drones[0].x;Core.step(a,.05);Core.step(b,.05);
  assert.ok(a.drones[0].x-x<b.drones[0].x-x);
});

test('boost destroys drones for 80 points and pauses their respawn for four seconds',()=>{
  const g=sector(7),d=g.drones[0],score=g.score;
  Object.assign(d,{x:g.player.x,y:g.player.y,wait:0});Core.boost(g);Core.step(g,0);
  assert.equal(g.health,3);assert.equal(g.score,score+80);assert.equal(g.smashed,1);assert.equal(d.wait,4);
  assert.ok(d.x===20||d.x===g.width-20);assert.equal(d.y,100);
});

test('shield deflects a drone without awarding points, and no shield causes damage',()=>{
  const g=sector(7),d=g.drones[0],score=g.score;
  Object.assign(d,{x:g.player.x,y:g.player.y,wait:0});g.shieldTime=6;Core.step(g,0);
  assert.equal(g.health,3);assert.equal(g.score,score);assert.equal(d.wait,2);
  assert.equal(g.events.filter(e=>e.type==='deflect').length,1);
  g.shieldTime=0;d.wait=0;Core.step(g,0);assert.equal(g.health,2);
});

test('moving station follows a bounded orbit and changes position over time',()=>{
  const g=sector(8);safeSpot(g);Core.step(g,0);const first={...g.station};advance(g,2);
  assert.ok(g.station.x!==first.x||g.station.y!==first.y);
  assert.ok(g.station.x>=g.width*.21&&g.station.x<=g.width*.79);
  assert.ok(g.station.y>=115&&g.station.y<=g.height-48);
});

test('moving station accepts cargo at its current orbital position',()=>{
  const g=sector(8);Core.step(g,0);g.player.x=g.station.x;g.player.y=g.station.y;g.cargo=2;
  Core.step(g,0);assert.equal(g.deliveries,1);assert.equal(g.cargo,0);assert.equal(g.levelCargo,2);
});

test('storm waits for its warning phase, expands radially and repeats every eight seconds',()=>{
  const g=sector(9);safeSpot(g);g.stageElapsed=1;Core.step(g,0);assert.equal(g.stormRadius,-1);
  g.stageElapsed=2;Core.step(g,0);const radius=g.stormRadius;assert.ok(radius>0);
  g.stageElapsed=3;Core.step(g,0);assert.ok(g.stormRadius>radius);
  g.stageElapsed=8.5;Core.step(g,0);assert.equal(g.stormRadius,-1);
});

test('storm damages only near its ring, while boost and shield both protect',()=>{
  for(const protection of ['none','boost','shield']){
    const g=sector(9);g.stageElapsed=2.8;const radius=Math.hypot(g.width,g.height)/6;
    g.player.x=g.width*.5+radius;g.player.y=g.height*.55;
    if(protection==='boost')Core.boost(g);if(protection==='shield')g.shieldTime=6;
    Core.step(g,0);assert.equal(g.health,protection==='none'?2:3,protection);
  }
  const safe=sector(9);safe.stageElapsed=2.8;safe.player.x=safe.width*.5;safe.player.y=safe.height*.55;
  Core.step(safe,0);assert.equal(safe.health,3);
});

test('mixed final config has mines, drones, moving station and storm but no portals',()=>{
  const g=sector(10);assert.equal(g.mines.length,2);assert.equal(g.drones.length,2);assert.equal(g.portals.length,0);
  for(const mechanic of ['mines','drones','moving','storm'])assert.equal(Core.has(g,mechanic),true);
  assert.equal(Core.has(g,'wind'),false);assert.equal(Core.has(g,'portals'),false);
});

test('leaving a sector removes obsolete mechanics and resets local timers',()=>{
  const g=sector(4);g.stageElapsed=20;g.levelCargo=7;Core.step(g,0);
  assert.equal(g.level,5);assert.equal(g.mines.length,0);assert.equal(g.drones.length,0);assert.equal(g.portals.length,2);
  assert.equal(g.stageElapsed,0);assert.equal(g.portalCooldown,0);assert.equal(g.stormRadius,-1);
});

test('pause freezes every mechanic, sector clock and target state',()=>{
  for(const level of [4,5,6,7,8,9,10]){
    const g=sector(level);g.portalCooldown=.7;Core.pause(g);const before=JSON.stringify(g);
    advance(g,10,{x:1,y:1});assert.equal(JSON.stringify(g),before,`sector ${level}`);
    Core.resume(g);Core.step(g,.05);assert.equal(g.mode,'playing');close(g.stageElapsed,.05);
  }
});

test('resize scales all configured mechanic positions and keeps progress',()=>{
  for(const level of [4,5,7,10]){
    const g=sector(level);g.levelCargo=2;g.levelSmashes=1;g.stageElapsed=3;
    const groups=['mines','drones','portals'];const old=Object.fromEntries(groups.map(key=>[key,g[key].map(o=>({...o}))]));
    Core.resize(g,450,300);
    for(const key of groups)g[key].forEach((o,i)=>{close(o.x,old[key][i].x*.5);close(o.y,old[key][i].y*.5);});
    assert.equal(g.levelCargo,2);assert.equal(g.levelSmashes,1);assert.equal(g.stageElapsed,3);assert.ok(g.invulnerable>=1.5);
  }
});

test('restarting either mode removes zone objects and resets every progress field',()=>{
  const g=sector(10);g.elapsed=500;g.stageElapsed=30;g.levelSmashes=9;g.portalCooldown=1;g.stormRadius=200;
  Core.start(g,'endless');assert.equal(g.runMode,'endless');assert.equal(g.level,1);assert.equal(g.elapsed,0);assert.equal(g.stageElapsed,0);
  assert.equal(g.levelSmashes,0);assert.equal(g.portalCooldown,0);assert.equal(g.stormRadius,-1);
  for(const key of ['mines','drones','portals'])assert.deepEqual(g[key],[]);
  assert.equal(g.timeLeft,Infinity);Core.start(g);assert.equal(g.runMode,'campaign');assert.equal(g.timeLeft,60);
});

test('endless has no deadline even after far more than a campaign sector duration',()=>{
  const g=fresh('endless');g.stageElapsed=10000;g.elapsed=10000;Core.step(g,.05);
  assert.equal(g.mode,'playing');assert.equal(g.reason,'');assert.equal(g.timeLeft,Infinity);
});

test('endless sector 10 advances to 11 with no victory and an infinite fresh timer',()=>{
  const g=sector(10,'endless');safeSpot(g);g.levelCargo=12;const score=g.score;Core.step(g,0);
  assert.equal(g.level,11);assert.equal(g.mode,'playing');assert.equal(g.score,score+1500);
  assert.equal(g.events.filter(e=>e.type==='victory'||e.type==='over').length,0);
  assert.equal(g.timeLeft,Infinity);assert.equal(Core.levelConfig(g).goal,6);assert.deepEqual(Core.levelConfig(g).mechanics,[]);
});

test('endless repeats mechanisms after ten sectors while gradually increasing and capping goals',()=>{
  const g=fresh('endless');
  for(const level of [1,11,21,51,101]){
    g.level=level;assert.equal(Core.levelConfig(g).goal,4+Math.min(10,Math.floor((level-1)/10)*2));
    assert.deepEqual(Core.levelConfig(g).mechanics,[]);
  }
  g.level=13;assert.equal(Core.levelConfig(g).smashGoal,3);assert.equal(Core.has(g,'smash'),true);
  assert.equal(Core.LEVELS[0].goal,4); // Derived endless goals never mutate campaign configuration.
});

test('endless can still end from health depletion, and does so exactly once',()=>{
  const g=fresh('endless');g.health=1;
  Object.assign(g.hazards[0],{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0});Core.step(g,0);
  assert.equal(g.mode,'over');assert.equal(g.reason,'health');assert.equal(g.health,0);
  Core.step(g,.05);assert.equal(g.events.filter(e=>e.type==='over').length,1);
});

test('campaign traverses all ten sector configurations and grants one final victory',()=>{
  const g=fresh();let expectedReward=0;
  for(let level=1;level<=10;level++){
    assert.equal(g.level,level);const cfg=Core.levelConfig(g);expectedReward+=cfg.reward;
    safeSpot(g);g.invulnerable=2;g.levelCargo=cfg.goal;g.levelSmashes=cfg.smashGoal||0;
    Core.step(g,0);quiet(g);
  }
  assert.equal(g.mode,'over');assert.equal(g.reason,'victory');assert.equal(g.level,10);
  assert.equal(g.score,expectedReward+90*15);assert.equal(g.events.filter(e=>e.type==='level').length,9);
  assert.equal(g.events.filter(e=>e.type==='victory').length,1);assert.equal(g.events.filter(e=>e.type==='over').length,1);
});

test('randomized mechanic runs keep coordinates, timers and resources finite and valid',()=>{
  for(let level=1;level<=10;level++){
    const g=sector(level);g.invulnerable=1000;
    for(let frame=0;frame<600;frame++){
      if(frame%130===0){g.boostCooldown=0;Core.boost(g);}
      Core.step(g,1/60,{x:Math.sin(frame*.03+level),y:Math.cos(frame*.02)});
      assert.ok(Number.isFinite(g.player.x)&&Number.isFinite(g.player.y));
      assert.ok(g.player.x>=15&&g.player.x<=g.width-15&&g.player.y>=15&&g.player.y<=g.height-15);
      assert.ok(g.health>=0&&g.health<=3&&g.cargo>=0&&g.cargo<=5);
      assert.ok(g.portalCooldown>=0&&g.stageElapsed>=0&&g.timeLeft>=0);
    }
  }
});

test('banked cargo at the smash gate cannot skip the next new-mechanic sectors',()=>{
  const g=sector(3);g.levelCargo=40;g.levelSmashes=3;Core.step(g,0);
  assert.equal(g.level,4);assert.equal(g.levelCargo,Core.CAPACITY-1);
  assert.deepEqual(g.events.filter(e=>e.type==='level').map(e=>e.level),[4]);
});

test('resizing the smash trial preserves all unbroken practice targets',()=>{
  const g=sector(3);
  const practice=()=>g.hazards.filter(h=>h.r===24&&h.vx===0&&h.vy===0);
  assert.equal(practice().length,3);Core.resize(g,320,400);
  assert.equal(practice().length,3);assert.ok(g.hazards.length>=3);
});
