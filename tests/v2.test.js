'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

// Isolate each v2 mechanic from procedural pickups, spawns and accidental damage.
function game(seed = 91, width = 900, height = 600) {
  const g = Core.createGame({seed,width,height});
  Core.start(g);
  g.items = [];
  g.powerups = [];
  g.powerupTimer = 1000;
  g.hazards.forEach(h => { h.delay = 1000; });
  return g;
}
function advance(g, seconds) {
  const frames = Math.floor(seconds / .05);
  for (let i=0; i<frames; i++) Core.step(g,.05);
  const remainder = seconds - frames*.05;
  if (remainder > 1e-10) Core.step(g,remainder);
}
function deliver(g, cargo) {
  g.cargo = cargo;
  g.deliveryCooldown = 0;
  Object.assign(g.player,{x:g.station.x,y:g.station.y});
  Core.step(g,0);
  g.hazards.forEach(h => {h.delay=1000;});
  return g.events.filter(e=>e.type==='deliver').at(-1);
}
function collide(g, options = {}) {
  g.invulnerable = 0;
  const rock = g.hazards[0];
  Object.assign(rock,{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0},options);
  Core.step(g,0);
  return rock;
}
function powerup(g,type) {
  g.powerups.push({x:g.player.x,y:g.player.y,r:15,type,ttl:12});
  Core.step(g,0);
}
function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual-expected)<epsilon, `${actual} should equal ${expected}`);
}

test('campaign starts with a readable route and introduces its magnet in sector 2', () => {
  const g=Core.createGame({seed:1});
  assert.equal(g.items.length,8);
  assert.equal(g.powerups.length,0);
  assert.deepEqual(Core.LEVELS[1].mechanics,['magnet']);
  assert.equal(g.level,1); assert.equal(g.levelCargo,0);
  assert.equal(g.combo,0); assert.equal(g.maxCombo,0);
  assert.equal(g.deliveredCargo,0); assert.equal(g.smashed,0);
  assert.deepEqual(Core.LEVELS.map(x=>x.goal),[4,6,6,7,8,8,9,9,10,12]);
  assert.deepEqual(Core.LEVELS.map(x=>x.reward),[250,350,450,550,650,750,850,950,1050,1500]);
});

test('combo payouts progress 1x, 1.5x, 2x, 2.5x, 3x and remain capped', () => {
  const g=game(), amounts=[], multipliers=[];
  for(let i=0;i<7;i++) {
    const event=deliver(g,1);
    amounts.push(event.amount); multipliers.push(event.multiplier);
    assert.equal(g.combo,i+1); assert.equal(g.comboTime,12);
  }
  assert.deepEqual(amounts,[100,150,200,250,300,300,300]);
  assert.deepEqual(multipliers,[1,1.5,2,2.5,3,3,3]);
  assert.equal(g.maxCombo,7);
  assert.equal(g.score,1850); // 1,600 in deliveries + first sector's 250 bonus.
});

test('nextPayout previews the next delivery including active combo', () => {
  const g=game(); g.cargo=5;
  assert.equal(Core.nextPayout(g),1100);
  g.combo=1;g.comboTime=12;assert.equal(Core.nextPayout(g),1650);
  g.combo=4;assert.equal(Core.nextPayout(g),3300);
  g.combo=90;assert.equal(Core.nextPayout(g),3300);
  g.comboTime=0;assert.equal(Core.nextPayout(g),1100);
  g.cargo=0;assert.equal(Core.nextPayout(g),0);
});

test('combo expiry emits one loss event and resets the next delivery to 1x', () => {
  const g=game(); deliver(g,1);deliver(g,1);
  g.comboTime=.025;g.events=[];
  Core.step(g,.05);
  assert.equal(g.combo,0); assert.equal(g.comboTime,0);
  assert.equal(g.maxCombo,2);
  assert.equal(g.events.filter(e=>e.type==='comboLost').length,1);
  Core.step(g,.05);
  assert.equal(g.events.filter(e=>e.type==='comboLost').length,1);
  const event=deliver(g,1);
  assert.equal(event.amount,100); assert.equal(event.combo,1);
});

test('an unprotected hit breaks a combo but preserves the historical maximum', () => {
  const g=game();deliver(g,1);deliver(g,1);g.cargo=5;
  collide(g);
  assert.equal(g.health,2);assert.equal(g.combo,0);assert.equal(g.comboTime,0);
  assert.equal(g.maxCombo,2);assert.equal(g.cargo,2);assert.equal(g.lostCargo,3);
  const event=deliver(g,1);assert.equal(event.multiplier,1);
});

test('sector 1 rollover retains surplus cargo, adds its reward, heals and recharges boost', () => {
  const g=game();g.health=1;g.boostCooldown=2;
  deliver(g,5);
  assert.equal(g.level,2);assert.equal(g.levelCargo,1);
  assert.equal(g.deliveredCargo,5);assert.equal(g.score,1350);
  assert.equal(g.health,2);assert.equal(g.boostCooldown,0);assert.ok(g.invulnerable>=2);
  assert.equal(g.powerups.at(-1).type,'magnet');
  assert.deepEqual(g.events.filter(e=>e.type==='level').map(e=>[e.level,e.amount]),[[2,250]]);
});

test('sector 2 applies rollover, its reward and the slow-time utility pickup', () => {
  const g=game();deliver(g,5);deliver(g,5);
  assert.equal(g.level,3);assert.equal(g.levelCargo,0);
  assert.equal(g.deliveredCargo,10);assert.equal(g.deliveries,2);
  assert.equal(g.score,3350); // 1,100 + 250 + 1,650 + 350.
  assert.equal(g.health,3);
  assert.equal(g.powerups.at(-1).type,'slow');
  assert.deepEqual(g.events.filter(e=>e.type==='level').map(e=>e.amount),[250,350]);
});

test('18 delivered cargo no longer ends the campaign and the smash lesson remains gated', () => {
  const g=game();
  for(const count of [4,5,1,5,3]) deliver(g,count);
  assert.equal(g.deliveredCargo,18);assert.equal(g.level,3);assert.equal(g.levelCargo,8);
  assert.equal(g.mode,'playing');assert.equal(g.reason,'');assert.equal(g.cargo,0);
  assert.equal(g.score,7270); // Delivery points 6,670 plus rewards 250 + 350.
  assert.equal(g.events.filter(e=>e.type==='victory').length,0);
  assert.equal(g.events.filter(e=>e.type==='over').length,0);
});

test('campaign final victory uses ceil(remaining seconds) times 15 and keeps delivery overshoot', () => {
  const g=game();g.level=10;g.levelCargo=11;g.elapsed=400;g.stageElapsed=69.75;g.timeLeft=20.25;
  // Final-sector movement places the station on its orbit before delivery detection.
  const phase=g.stageElapsed*.4;
  g.station.x=g.width*(.5+.29*Math.cos(phase));
  g.station.y=Math.max(115,Math.min(g.height-48,g.height*(.53+.24*Math.sin(phase))));
  deliver(g,5);
  assert.equal(g.reason,'victory');assert.equal(g.levelCargo,4);
  assert.equal(g.score,1100+1500+21*15);
  assert.equal(g.events.find(e=>e.type==='victory').amount,1500+315);
  assert.equal(g.events.filter(e=>e.type==='victory').length,1);
  assert.equal(g.events.filter(e=>e.type==='over').length,1);
  const snapshot=JSON.stringify(g);Core.step(g,.05);assert.equal(JSON.stringify(g),snapshot);
});

test('deadline reached before the final delivery ends as time-out, not victory', () => {
  const g=game();g.level=10;g.levelCargo=11;g.cargo=1;
  Object.assign(g.player,{x:g.station.x,y:g.station.y});g.stageElapsed=89.99;g.elapsed=599.99;
  Core.step(g,.02);
  assert.equal(g.reason,'time');assert.equal(g.score,0);assert.equal(g.deliveredCargo,0);
  assert.equal(g.events.filter(e=>e.type==='victory').length,0);
});

test('all utility pickups collect once with their intended durations', () => {
  for(const [type,timer,duration] of [['magnet','magnetTime',8],['shield','shieldTime',6],['slow','slowTime',6]]) {
    const g=game();powerup(g,type);
    assert.equal(g[timer],duration);assert.equal(g.powerups.length,0);
    assert.deepEqual(g.events.filter(e=>e.type==='powerup').map(e=>e.power),[type]);
    Core.step(g,0);assert.equal(g.events.filter(e=>e.type==='powerup').length,1);
  }
});

test('collecting the same utility refreshes duration instead of stacking forever', () => {
  const g=game();powerup(g,'shield');advance(g,2);close(g.shieldTime,4);
  powerup(g,'shield');assert.equal(g.shieldTime,6);
});

test('magnet pulls only nearby cargo while there is capacity', () => {
  const g=game();powerup(g,'magnet');
  const near={x:g.player.x+100,y:g.player.y,r:11,wait:0};
  const far={x:g.player.x+160,y:g.player.y,r:11,wait:0};g.items=[near,far];
  const oldNear=near.x,oldFar=far.x;
  Core.step(g,.05);close(near.x,oldNear-18);assert.equal(far.x,oldFar);
  g.cargo=5;const frozenX=near.x;Core.step(g,.05);assert.equal(near.x,frozenX);
  g.cargo=0;advance(g,.3);assert.equal(g.cargo,1);assert.ok(near.wait>0);
});

test('magnet does not attract cargo after its duration expires', () => {
  const g=game();g.magnetTime=.01;
  const item={x:g.player.x+100,y:g.player.y,r:11,wait:0};g.items=[item];const before=item.x;
  Core.step(g,.05);assert.equal(g.magnetTime,0);assert.equal(item.x,before);
});

test('shield deflects asteroids without damage, lost cargo, broken combo or smash points', () => {
  const g=game();deliver(g,1);g.cargo=3;powerup(g,'shield');
  const oldRock=collide(g);
  assert.equal(g.health,3);assert.equal(g.cargo,3);assert.equal(g.combo,1);
  assert.equal(g.score,100);assert.equal(g.smashed,0);assert.notEqual(g.hazards[0],oldRock);
  assert.equal(g.events.filter(e=>e.type==='deflect').length,1);
  assert.equal(g.events.filter(e=>e.type==='hit').length,0);
});

test('expired shield no longer blocks collisions', () => {
  const g=game();g.shieldTime=.01;Core.step(g,.05);collide(g);
  assert.equal(g.shieldTime,0);assert.equal(g.health,2);
});

test('slow-time affects asteroid translation and rotation but not the ship speed', () => {
  const slow=game(),normal=game();powerup(slow,'slow');
  for(const g of [slow,normal]) Object.assign(g.hazards[0],{x:700,y:100,vx:100,vy:50,rotation:2,angle:0,delay:0});
  Core.step(slow,.05,{x:1});Core.step(normal,.05,{x:1});
  close(slow.hazards[0].x-700,5*.38);close(slow.hazards[0].y-100,2.5*.38);
  close(slow.hazards[0].angle,.1*.38);close(slow.player.x,normal.player.x);
  slow.slowTime=.01;const before=slow.hazards[0].x;Core.step(slow,.05);close(slow.hazards[0].x-before,5);
});

test('uncollected pickups expire and periodic utilities cycle shield, slow, magnet', () => {
  const g=game();g.powerups=[{x:850,y:550,r:15,type:'magnet',ttl:.01}];
  Core.step(g,.05);assert.equal(g.powerups.length,0);
  const types=[];
  for(let i=0;i<3;i++){g.powerupTimer=0;Core.step(g,0);types.push(g.powerups[0].type);g.powerups=[];}
  assert.deepEqual(types,['shield','slow','magnet']);
});

test('periodic spawn respects the two-pickup arena limit', () => {
  const g=game();g.powerups=[
    {x:800,y:400,r:15,type:'shield',ttl:12},
    {x:800,y:500,r:15,type:'slow',ttl:12}
  ];g.powerupTimer=0;Core.step(g,0);assert.equal(g.powerups.length,2);assert.equal(g.powerupTimer,10);
});

test('boost cooldown is 2.4 seconds, duration is 0.4 and smashing pays exactly 40', () => {
  const g=game();assert.equal(Core.boost(g),true);assert.equal(g.boostCooldown,2.4);assert.equal(g.boostTime,.4);
  assert.equal(Core.boost(g),false);const rock=collide(g);
  assert.equal(g.health,3);assert.equal(g.score,40);assert.equal(g.smashed,1);assert.notEqual(g.hazards[0],rock);
  assert.equal(g.events.filter(e=>e.type==='smash').length,1);
  Core.step(g,0);assert.equal(g.score,40);
  advance(g,2.45);assert.equal(g.boostTime,0);assert.equal(g.boostCooldown,0);assert.equal(Core.boost(g),true);
});

test('boost takes priority over shield and can smash several overlapping rocks once each', () => {
  const g=game();powerup(g,'shield');Core.boost(g);
  for(let i=0;i<3;i++)Object.assign(g.hazards[i],{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0});
  Core.step(g,0);assert.equal(g.score,120);assert.equal(g.smashed,3);assert.equal(g.health,3);
  assert.equal(g.events.filter(e=>e.type==='deflect').length,0);
});

test('pause freezes combo, all utility durations, pickup lifetime and spawn timer', () => {
  const g=game();deliver(g,1);powerup(g,'magnet');powerup(g,'shield');powerup(g,'slow');Core.boost(g);
  g.powerups.push({x:850,y:500,r:15,type:'magnet',ttl:10});
  Core.pause(g);const snapshot=JSON.stringify(g);advance(g,20);assert.equal(JSON.stringify(g),snapshot);
  Core.resume(g);Core.step(g,.05);close(g.magnetTime,7.95);close(g.shieldTime,5.95);close(g.slowTime,5.95);close(g.comboTime,11.95);
});

test('restart clears v2 progress and temporary powers after victory or pause', () => {
  const g=game();g.score=9000;g.level=3;g.levelCargo=7;g.combo=9;g.comboTime=3;g.maxCombo=9;
  g.magnetTime=5;g.shieldTime=4;g.slowTime=2;g.smashed=12;g.deliveredCargo=17;g.mode='over';g.reason='victory';
  Core.start(g);
  assert.equal(g.mode,'playing');assert.equal(g.level,1);assert.equal(g.levelCargo,0);assert.equal(g.score,0);
  for(const key of ['combo','comboTime','maxCombo','magnetTime','shieldTime','slowTime','smashed','deliveredCargo'])assert.equal(g[key],0,key);
  assert.equal(g.powerups.length,0);assert.equal(g.powerupTimer,10);assert.equal(g.powerupIndex,1);
  assert.deepEqual(g.events,[]);assert.equal(g.reason,'');
});

test('resize scales powerups, preserves v2 progress and rebalances level-specific danger', () => {
  const g=game();g.level=3;g.levelCargo=4;g.combo=3;g.comboTime=5;g.magnetTime=7;g.shieldTime=2;g.slowTime=3;
  g.powerups=[{x:450,y:300,r:15,type:'shield',ttl:8}];
  Core.resize(g,320,400);
  assert.equal(g.powerups[0].x,160);assert.equal(g.powerups[0].y,200);assert.equal(g.powerups[0].ttl,8);
  assert.equal(g.level,3);assert.equal(g.levelCargo,4);assert.equal(g.combo,3);assert.equal(g.comboTime,5);
  assert.equal(g.magnetTime,7);assert.equal(g.shieldTime,2);assert.equal(g.slowTime,3);
  assert.equal(g.hazards.length,3);assert.ok(g.invulnerable>=1.5);
  Core.resize(g,1000,600);assert.equal(g.hazards.length,7);
});
