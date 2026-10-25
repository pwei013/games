'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

function game(seed = 42, width = 900, height = 600) {
  const g = Core.createGame({ seed, width, height });
  Core.start(g,'campaign',{tutorialSeen:true});
  g.hazards.forEach(h => { h.delay = 1000; });
  return g;
}
function advance(g, seconds, input) {
  for (let i = 0; i < Math.ceil(seconds / .01); i++) Core.step(g, .01, input);
}
function pickup(g, count) {
  g.items.forEach(item => { item.wait = 100; });
  for (let i = 0; i < count; i++) {
    Object.assign(g.items[0], {x: g.player.x, y: g.player.y, wait: 0});
    Core.step(g, 0);
  }
}
function collide(g) {
  g.invulnerable = 0;
  Object.assign(g.hazards[0], {x: g.player.x,y: g.player.y,vx: 0,vy: 0,delay: 0});
  Core.step(g, 0);
  g.hazards[0].delay = 1000;
}

test('initial state has 60 seconds, three shields and a clear cargo hold', () => {
  const g = Core.createGame({seed: 3});
  assert.equal(g.mode, 'ready'); assert.equal(g.health,3); assert.equal(g.timeLeft,60);
  assert.equal(g.cargo,0); assert.equal(g.score,0); assert.equal(g.items.length,8);
});
test('seeded games produce repeatable item and hazard layouts', () => {
  const a = game(17), b = game(17);
  assert.deepEqual(a.items,b.items); assert.deepEqual(a.hazards,b.hazards);
});
test('ready, paused and over states do not simulate physics or time', () => {
  const g = Core.createGame({seed: 3});
  for (const mode of ['ready','paused','over']) {
    g.mode = mode;
    const before = JSON.stringify(g);
    Core.step(g,.05,{x:1,y:1});
    assert.equal(JSON.stringify(g),before);
  }
});
test('diagonal movement has the same speed as horizontal movement', () => {
  const a = game(), b = game();
  a.items=[]; b.items=[];
  const start = {...a.player};
  advance(a,.5,{x:1,y:0}); advance(b,.5,{x:1,y:1});
  assert.ok(Math.abs(Math.hypot(a.player.x-start.x,a.player.y-start.y)-Math.hypot(b.player.x-start.x,b.player.y-start.y))<.00001);
});
test('ship stays within all four arena boundaries', () => {
  const g = game(1,320,400); g.items=[];
  advance(g,10,{x:-1,y:-1}); assert.equal(g.player.x,15); assert.equal(g.player.y,15);
  advance(g,10,{x:1,y:1}); assert.equal(g.player.x,305); assert.equal(g.player.y,385);
});
test('invalid or delayed frame delta does not create a physics jump', () => {
  const g = game(); const x = g.player.x;
  Core.step(g,NaN,{x:1}); assert.equal(g.player.x,x);
  Core.step(g,-1,{x:1}); assert.equal(g.player.x,x);
  Core.step(g,99,{x:1}); assert.ok(g.player.x-x<=17); assert.equal(g.elapsed,.05);
});
test('cargo is automatically collected and capacity never exceeds five', () => {
  const g = game(); pickup(g,8);
  assert.equal(g.cargo,5); assert.equal(g.collected,5);
  assert.equal(g.events.filter(e=>e.type==='pickup').length,5);
});
test('collecting cargo has no score until it reaches the station', () => {
  const g = game(); pickup(g,3); assert.equal(g.score,0);
  Object.assign(g.player,{x:g.station.x,y:g.station.y}); Core.step(g,0);
  assert.equal(g.score,450); assert.equal(g.cargo,0); assert.equal(g.deliveries,1);
});
test('full hold pays a meaningful 2.2x bonus and station relocates', () => {
  const g = game(); pickup(g,5); const original = {...g.station};
  Object.assign(g.player,{x:g.station.x,y:g.station.y}); Core.step(g,0);
  assert.equal(g.score,1100+250); assert.notEqual(g.station.index,original.index);
  assert.ok(g.station.x!==original.x||g.station.y!==original.y);
});
test('empty deliveries and repeated idle frames cannot generate score', () => {
  const g = game(); g.items=[];
  Object.assign(g.player,{x:g.station.x,y:g.station.y}); advance(g,1);
  assert.equal(g.score,0); assert.equal(g.deliveries,0);
});
test('payout table handles valid and out-of-range cargo counts', () => {
  assert.deepEqual([0,1,2,3,4,5].map(Core.payout),[0,100,240,450,720,1100]);
  assert.equal(Core.payout(-1),0); assert.equal(Core.payout(8),1960);
});
test('collision loses one shield and half the cargo rounded up, not score', () => {
  const g = game(); pickup(g,5); g.score=240; collide(g);
  assert.equal(g.health,2); assert.equal(g.cargo,2); assert.equal(g.lostCargo,3); assert.equal(g.score,240);
});
test('collision invulnerability prevents damage from overlapping asteroids', () => {
  const g = game();
  for (const h of g.hazards) Object.assign(h,{x:g.player.x,y:g.player.y,vx:0,vy:0,delay:0});
  Core.step(g,.01); assert.equal(g.health,2);
  advance(g,1); assert.equal(g.health,2);
});
test('boost works once per cooldown and grants brief collision immunity', () => {
  const g = game(); assert.equal(Core.boost(g),true); assert.equal(Core.boost(g),false);
  collide(g); assert.equal(g.health,3); assert.equal(g.boostCooldown,2.4);
  advance(g,3.3); assert.equal(Core.boost(g),true);
});
test('boost cannot fire from ready, paused or over states', () => {
  const g=game(); for (const mode of ['ready','paused','over']) {g.mode=mode;g.boostCooldown=0;assert.equal(Core.boost(g),false);}
});
test('pause freezes countdown, cooldown, damage recovery and position', () => {
  const g = game(); Core.boost(g); g.invulnerable=1; Core.pause(g);
  const before=JSON.stringify(g); advance(g,5,{x:1,y:1}); assert.equal(JSON.stringify(g),before);
  Core.resume(g); Core.step(g,.05,{x:1}); assert.equal(g.mode,'playing'); assert.ok(g.timeLeft<60);
});
test('third collision ends the game exactly once', () => {
  const g=game(); collide(g); collide(g); collide(g);
  assert.equal(g.mode,'over'); assert.equal(g.health,0); assert.equal(g.reason,'health');
  assert.equal(g.events.filter(e=>e.type==='over').length,1);
  Core.step(g,.05); assert.equal(g.health,0);
});
test('first-sector deadline ends the game without credit for undelivered cargo', () => {
  const g=game(); pickup(g,5); g.elapsed=159.99; g.stageElapsed=59.99; Core.step(g,.02);
  assert.equal(g.mode,'over'); assert.equal(g.reason,'time'); assert.equal(g.timeLeft,0); assert.equal(g.score,0);
});
test('restart clears score, cargo, timers, health, events and previous result', () => {
  const g=game(); pickup(g,5); collide(g); g.score=1230; Core.boost(g); Core.pause(g);
  Core.start(g,'campaign',{tutorialSeen:true});
  assert.equal(g.mode,'playing'); assert.equal(g.health,3); assert.equal(g.cargo,0); assert.equal(g.score,0);
  assert.equal(g.timeLeft,60); assert.equal(g.boostCooldown,0); assert.equal(g.invulnerable,0); assert.equal(g.reason,''); assert.deepEqual(g.events,[]);
});
test('resize preserves state and keeps player, cargo and station in bounds', () => {
  const g=game(); pickup(g,2); g.score=500; advance(g,.5);
  Core.resize(g,320,400);
  assert.equal(g.width,320); assert.equal(g.height,400); assert.equal(g.score,500); assert.equal(g.cargo,2);
  assert.ok(g.player.x>=15&&g.player.x<=305); assert.ok(g.player.y>=15&&g.player.y<=385);
  assert.ok(g.station.x>=48&&g.station.x<=272); assert.ok(g.station.y>=80&&g.station.y<=352);
  for(const item of g.items) {assert.ok(item.x>=0&&item.x<=320);assert.ok(item.y>=0&&item.y<=400);}
});
test('randomized first-sector runs never produce invalid coordinates or negative resources', () => {
  for (let seed=1;seed<=30;seed++) {
    const g=game(seed,seed%2?320:1000,seed%2?420:600);
    g.hazards.forEach(h=>{h.delay=0;});
    for(let frame=0;frame<5401&&g.mode==='playing';frame++) {
      if(frame%210===0)Core.boost(g);
      Core.step(g,1/60,{x:Math.sin(frame*.03+seed),y:Math.cos(frame*.019)});
      if(g.mode==='upgrade')assert.equal(Core.chooseUpgrade(g,'standard'),true);
      g.events.length=0;
      assert.ok(Number.isFinite(g.player.x)&&Number.isFinite(g.player.y));
      assert.ok(g.cargo>=0&&g.cargo<=5); assert.ok(g.health>=0&&g.health<=3); assert.ok(g.timeLeft>=0);
    }
    assert.equal(g.mode,'over');
  }
});
test('desktop-to-mobile resize rebalances hazard density and gives a safe re-entry', () => {
  const g=game(42,900,600); assert.equal(g.hazards.length,6);
  Core.resize(g,320,390); assert.equal(g.hazards.length,3); assert.ok(g.invulnerable>=1.5);
  Core.resize(g,1000,600); assert.equal(g.hazards.length,6);
});
